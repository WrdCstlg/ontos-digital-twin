package main

// The Ontology API operations (increment 3). `api_action` submits the
// gate-annotate action type through /api/v1 with an API token, the way another
// system would; after an acknowledged one, the same client reads the person
// back through /api/v1 as `api_read`. api.read_your_writes judges each pair:
// the read must show the acknowledged submission, or a later one, as the
// person's last change.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const (
	opAPIAction = "api_action"
	opAPIRead   = "api_read"

	// apiPace is the least time between one client's API operations. An
	// operation is two requests, so a client makes at most 240 a minute,
	// under the API's 300 per token; each client has its own token.
	apiPace = 500 * time.Millisecond
)

// createTokens makes one API token per client through the developer router,
// with the session the driver signed in with: role editor (gate-annotate's
// minimum), scopes read and actions, expiring in a day. Only prefixes are logged.
func (c *client) createTokens(ctx context.Context, n int, log *logger) error {
	c.tokens = make([]string, 0, n)
	for i := 0; i < n; i++ {
		body, err := json.Marshal(map[string]any{"json": map[string]any{
			"name":          fmt.Sprintf("gate driver %d", i),
			"role":          "editor",
			"scopes":        []string{"read", "actions"},
			"expiresInDays": 1,
		}})
		if err != nil {
			return err
		}
		resp, err := c.post(ctx, "/api/trpc/developer.createToken", string(body))
		if err != nil {
			return fmt.Errorf("create token %d: %w", i, err)
		}
		payload, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("create token %d: HTTP %d %s", i, resp.StatusCode, trpcMessage(payload))
		}
		var out struct {
			Result struct {
				Data struct {
					JSON struct {
						Token string `json:"token"`
					} `json:"json"`
				} `json:"data"`
			} `json:"result"`
		}
		if readErr != nil || json.Unmarshal(payload, &out) != nil || !strings.HasPrefix(out.Result.Data.JSON.Token, "ontos_") {
			return fmt.Errorf("create token %d: the answer carried no token", i)
		}
		token := out.Result.Data.JSON.Token
		c.tokens = append(c.tokens, token)
		log.printf("API token %d: %s…", i, token[:min(len(token), 14)])
	}
	return nil
}

// tokenFor gives each client its own token, so the API's per-token rate limit
// applies to one client's pace.
func (c *client) tokenFor(proc int64) string {
	if len(c.tokens) == 0 {
		return ""
	}
	return c.tokens[int(proc)%len(c.tokens)]
}

func (c *client) api(ctx context.Context, method, path, token string, body []byte) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	var r io.Reader
	if body != nil {
		r = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/api/v1"+path, r)
	if err != nil {
		cancel()
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}
	resp.Body = cancelOnClose{resp.Body, cancel}
	return resp, nil
}

// apiMessage reads an Ontology API error: { "error": { "code", "message" } }.
func apiMessage(payload []byte) string {
	var e struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(payload, &e) == nil && e.Error.Code != "" {
		return e.Error.Code + ": " + e.Error.Message
	}
	return ""
}

func transportResult(err error) result {
	var de *dialError
	if errors.As(err, &de) {
		return result{kind: schema.HistoryFail, err: "not sent: " + de.Error()}
	}
	return result{kind: schema.HistoryInfo, err: "indeterminate: " + err.Error()}
}

// apiActionValue is the ok value of api_action: the submission, and the note it
// wrote, which the oracle compares with what the read then shows.
type apiActionValue struct {
	Submission int64  `json:"submission"`
	Note       string `json:"note"`
}

// apiSubmit submits gate-annotate through the API. Like actions.submit, the
// answer is final: applied is ok, rejected is fail, and a conflict rolled back.
// 503 and other 5xx are info: the request may have been applied.
func (c *client) apiSubmit(ctx context.Context, proc int64, person, note string) result {
	body, err := json.Marshal(map[string]any{"params": map[string]string{"employee": person, "note": note}})
	if err != nil {
		return result{kind: schema.HistoryFail, err: "not sent: " + err.Error()}
	}
	resp, err := c.api(ctx, http.MethodPost, "/actions/"+gateAction+"/submit", c.tokenFor(proc), body)
	if err != nil {
		return transportResult(err)
	}
	payload, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		var out struct {
			Submission struct {
				ID     int64  `json:"id"`
				Status string `json:"status"`
			} `json:"submission"`
			Problems []struct {
				Message string `json:"message"`
			} `json:"problems"`
		}
		if readErr != nil || json.Unmarshal(payload, &out) != nil || out.Submission.ID <= 0 {
			return result{kind: schema.HistoryInfo, err: "indeterminate: answered, but the submission could not be read"}
		}
		if out.Submission.Status == "applied" {
			v, _ := json.Marshal(apiActionValue{Submission: out.Submission.ID, Note: note})
			return result{kind: schema.HistoryOK, value: v}
		}
		why := out.Submission.Status
		if len(out.Problems) > 0 {
			why += ": " + out.Problems[0].Message
		}
		return result{kind: schema.HistoryFail, err: fmt.Sprintf("submission %d %s", out.Submission.ID, why)}
	case resp.StatusCode == http.StatusConflict:
		return result{kind: schema.HistoryFail, err: "rolled back: " + apiMessage(payload)}
	case rejectedBeforeWork(resp.StatusCode):
		return result{kind: schema.HistoryFail, err: fmt.Sprintf("rejected: HTTP %d %s", resp.StatusCode, apiMessage(payload))}
	default:
		return result{kind: schema.HistoryInfo, err: fmt.Sprintf("indeterminate: HTTP %d %s", resp.StatusCode, apiMessage(payload))}
	}
}

// apiReadValue is what an api_read saw: whether the object was there, the
// submission its source names as its last change, and its gate note.
type apiReadValue struct {
	Found        bool    `json:"found"`
	SubmissionID *int64  `json:"submissionId"`
	GateNote     *string `json:"gateNote"`
}

// apiRead reads a person through the API. A read changes nothing, so any
// definite answer is ok, not found included; 5xx and no answer are info.
func (c *client) apiRead(ctx context.Context, proc int64, person string) result {
	resp, err := c.api(ctx, http.MethodGet, "/objects?iri="+url.QueryEscape(person), c.tokenFor(proc), nil)
	if err != nil {
		return transportResult(err)
	}
	payload, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		var obj struct {
			IRI        string `json:"iri"`
			Properties struct {
				GateNote *string `json:"gateNote"`
			} `json:"properties"`
			Source struct {
				SubmissionID *int64 `json:"submissionId"`
			} `json:"source"`
		}
		if readErr != nil || json.Unmarshal(payload, &obj) != nil || obj.IRI != person {
			return result{kind: schema.HistoryInfo, err: "indeterminate: answered, but the object could not be read"}
		}
		v, _ := json.Marshal(apiReadValue{Found: true, SubmissionID: obj.Source.SubmissionID, GateNote: obj.Properties.GateNote})
		return result{kind: schema.HistoryOK, value: v}
	case resp.StatusCode == http.StatusNotFound:
		v, _ := json.Marshal(apiReadValue{Found: false})
		return result{kind: schema.HistoryOK, value: v}
	case rejectedBeforeWork(resp.StatusCode):
		return result{kind: schema.HistoryFail, err: fmt.Sprintf("rejected: HTTP %d %s", resp.StatusCode, apiMessage(payload))}
	default:
		return result{kind: schema.HistoryInfo, err: fmt.Sprintf("indeterminate: HTTP %d %s", resp.StatusCode, apiMessage(payload))}
	}
}

// apiOp is one api_action and, when it is acknowledged, the read that follows,
// both recorded; then it waits out the client's pace. Once the drain has begun
// no read starts: two requests in a row could outlast the drain deadline and
// leave an operation without its completion.
func apiOp(ctx context.Context, h *history, counts *outcomeCounts, c *client, stop *stopSignal, proc int64, person, note string) schema.HistoryType {
	start := time.Now()
	key := "person/" + person
	kind := doOp(h, counts, proc, 0, opAPIAction, key, func() result { return c.apiSubmit(ctx, proc, person, note) })
	if kind == schema.HistoryOK && !stop.fired() {
		doOp(h, counts, proc, 0, opAPIRead, key, func() result { return c.apiRead(ctx, proc, person) })
	}
	if wait := time.Until(start.Add(apiPace)); wait > 0 {
		select {
		case <-time.After(wait):
		case <-stop.done:
		}
	}
	return kind
}

func isAPIOp(op string) bool { return op == opAPIAction || op == opAPIRead }

// usesPeople reports whether the plan annotates people, by either path.
func usesPeople(pl *plan) bool {
	return planUses(pl, opAction) || planUses(pl, opAPIAction) || planUses(pl, opAPIRead)
}
