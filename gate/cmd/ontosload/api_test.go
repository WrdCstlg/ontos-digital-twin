package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

// fakeOntos answers the driver's Ontology API calls as the app does, and
// records what it was sent.
type fakeOntos struct {
	mu       sync.Mutex
	submit   func(w http.ResponseWriter, r *http.Request)
	read     func(w http.ResponseWriter, r *http.Request)
	auth     []string
	bodies   []string
	reads    int
	tokenReq []string
}

func (f *fakeOntos) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.auth = append(f.auth, r.Header.Get("Authorization"))
	f.mu.Unlock()
	switch {
	case r.URL.Path == "/api/trpc/developer.createToken":
		f.mu.Lock()
		f.tokenReq = append(f.tokenReq, r.Header.Get("Cookie")+" "+string(body))
		n := len(f.tokenReq)
		f.mu.Unlock()
		token := "ontos_abcdefg" + string(rune('0'+n)) + "_" + strings.Repeat("A", 32)
		_, _ = w.Write([]byte(`{"result":{"data":{"json":{"token":"` + token + `","row":{"id":` + string(rune('0'+n)) + `}}}}}`))
	case r.URL.Path == "/api/v1/actions/gate-annotate/submit":
		f.mu.Lock()
		f.bodies = append(f.bodies, string(body))
		f.mu.Unlock()
		f.submit(w, r)
	case r.URL.Path == "/api/v1/objects":
		f.mu.Lock()
		f.reads++
		f.mu.Unlock()
		f.read(w, r)
	default:
		http.NotFound(w, r)
	}
}

func answer(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

func newFake(t *testing.T) (*fakeOntos, *client) {
	t.Helper()
	f := &fakeOntos{
		submit: answer(200, `{"submission":{"id":41,"status":"applied"},"problems":[]}`),
		read:   answer(200, `{"iri":"hr:Person/E-0101","properties":{"gateNote":"n"},"source":{"mappingId":1,"submissionId":41}}`),
	}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	c := newClient(srv.URL, 2)
	c.cookie = "ontos_session=s"
	c.tokens = []string{"ontos_aaaaaaaa_" + strings.Repeat("A", 32), "ontos_bbbbbbbb_" + strings.Repeat("B", 32)}
	return f, c
}

func TestCreateTokensMakesOnePerClientWithTheSession(t *testing.T) {
	f, c := newFake(t)
	c.tokens = nil
	log := newLogger(filepath.Join(t.TempDir(), "driver.log"))
	defer log.close()
	if err := c.createTokens(context.Background(), 3, log); err != nil {
		t.Fatal(err)
	}
	if len(c.tokens) != 3 || c.tokenFor(0) == c.tokenFor(1) || c.tokenFor(3) != c.tokenFor(0) {
		t.Fatalf("tokens %v", c.tokens)
	}
	for _, req := range f.tokenReq {
		if !strings.HasPrefix(req, "ontos_session=s ") || !strings.Contains(req, `"role":"editor"`) || !strings.Contains(req, `"scopes":["read","actions"]`) {
			t.Fatalf("token request %q", req)
		}
	}
}

func TestCreateTokensRefusesAnAnswerWithoutAToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"data":{"json":{}}}}`))
	}))
	defer srv.Close()
	c := newClient(srv.URL, 1)
	log := newLogger(filepath.Join(t.TempDir(), "driver.log"))
	defer log.close()
	if err := c.createTokens(context.Background(), 1, log); err == nil {
		t.Fatal("an answer with no token was accepted")
	}
}

func TestAPISubmitOutcomes(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		kind   schema.HistoryType
		err    string
	}{
		{"applied", 200, `{"submission":{"id":41,"status":"applied"},"problems":[]}`, schema.HistoryOK, ""},
		{"rejected and recorded", 200, `{"submission":{"id":42,"status":"rejected"},"problems":[{"message":"criterion failed"}]}`, schema.HistoryFail, "submission 42 rejected: criterion failed"},
		{"conflict", 409, `{"error":{"code":"conflict","message":"changed"}}`, schema.HistoryFail, "rolled back: conflict: changed"},
		{"bad token", 401, `{"error":{"code":"invalid_token","message":"revoked"}}`, schema.HistoryFail, "rejected: HTTP 401 invalid_token: revoked"},
		{"forbidden", 403, `{"error":{"code":"forbidden_role","message":"needs editor"}}`, schema.HistoryFail, "rejected: HTTP 403"},
		{"rate limited", 429, `{"error":{"code":"rate_limited","message":"slow down"}}`, schema.HistoryFail, "rejected: HTTP 429"},
		{"could not be checked", 503, `{"error":{"code":"unavailable","message":"retry"}}`, schema.HistoryInfo, "indeterminate: HTTP 503 unavailable: retry"},
		{"unreadable answer", 200, `not json`, schema.HistoryInfo, "indeterminate: answered"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, c := newFake(t)
			f.submit = answer(tc.status, tc.body)
			r := c.apiSubmit(context.Background(), 1, "hr:Person/E-0101", "note 1")
			if r.kind != tc.kind || !strings.Contains(r.err, tc.err) {
				t.Fatalf("got %s %q, want %s containing %q", r.kind, r.err, tc.kind, tc.err)
			}
			if f.auth[0] != "Bearer "+c.tokenFor(1) {
				t.Fatalf("sent authorization %q", f.auth[0])
			}
			if !strings.Contains(f.bodies[0], `"params":{"employee":"hr:Person/E-0101","note":"note 1"}`) {
				t.Fatalf("sent body %q", f.bodies[0])
			}
			if tc.kind == schema.HistoryOK {
				var v apiActionValue
				if err := json.Unmarshal(r.value, &v); err != nil || v.Submission != 41 || v.Note != "note 1" {
					t.Fatalf("ok value %s", r.value)
				}
			}
		})
	}
}

func TestAPIReadOutcomes(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		kind   schema.HistoryType
		value  string
	}{
		{"found", 200, `{"iri":"hr:Person/E-0101","properties":{"gateNote":"n"},"source":{"mappingId":1,"submissionId":41}}`, schema.HistoryOK, `{"found":true,"submissionId":41,"gateNote":"n"}`},
		{"found, never annotated", 200, `{"iri":"hr:Person/E-0101","properties":{},"source":{"mappingId":1,"submissionId":null}}`, schema.HistoryOK, `{"found":true,"submissionId":null,"gateNote":null}`},
		{"not found", 404, `{"error":{"code":"not_found","message":"No object"}}`, schema.HistoryOK, `{"found":false,"submissionId":null,"gateNote":null}`},
		{"another object", 200, `{"iri":"hr:Person/E-0999","properties":{},"source":{}}`, schema.HistoryInfo, ""},
		{"could not be checked", 503, `{"error":{"code":"unavailable","message":"retry"}}`, schema.HistoryInfo, ""},
		{"bad token", 401, `{"error":{"code":"invalid_token","message":"revoked"}}`, schema.HistoryFail, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, c := newFake(t)
			f.read = answer(tc.status, tc.body)
			r := c.apiRead(context.Background(), 0, "hr:Person/E-0101")
			if r.kind != tc.kind {
				t.Fatalf("got %s %q, want %s", r.kind, r.err, tc.kind)
			}
			if tc.value != "" && string(r.value) != tc.value {
				t.Fatalf("value %s, want %s", r.value, tc.value)
			}
		})
	}
}

func TestAPIReadNotSentIsFail(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close() // nothing listens there now
	c := newClient("http://"+addr, 1)
	c.tokens = []string{"t"}
	if r := c.apiRead(context.Background(), 0, "hr:Person/E-0101"); r.kind != schema.HistoryFail || !strings.HasPrefix(r.err, "not sent") {
		t.Fatalf("got %s %q", r.kind, r.err)
	}
}

func readHistoryFile(t *testing.T, path string) []schema.HistoryEntry {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out []schema.HistoryEntry
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var e schema.HistoryEntry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatal(err)
		}
		out = append(out, e)
	}
	return out
}

func TestAPIOpReadsBackOnlyWhatWasAcknowledged(t *testing.T) {
	f, c := newFake(t)
	path := filepath.Join(t.TempDir(), "history.jsonl")
	h, err := openHistory(path)
	if err != nil {
		t.Fatal(err)
	}
	var counts outcomeCounts
	stop := newStopSignal()

	start := time.Now()
	if k := apiOp(context.Background(), h, &counts, c, stop, 0, "hr:Person/E-0101", "n"); k != schema.HistoryOK {
		t.Fatalf("applied submission recorded %s", k)
	}
	if elapsed := time.Since(start); elapsed < apiPace {
		t.Fatalf("the client did not keep its pace: %v", elapsed)
	}
	f.submit = answer(503, `{"error":{"code":"unavailable","message":"retry"}}`)
	apiOp(context.Background(), h, &counts, c, stop, 0, "hr:Person/E-0101", "n2")
	// Stopped after an acknowledgement: no read starts.
	f.submit = answer(200, `{"submission":{"id":43,"status":"applied"},"problems":[]}`)
	stop.fire()
	apiOp(context.Background(), h, &counts, c, stop, 0, "hr:Person/E-0101", "n3")
	h.close()

	if f.reads != 1 {
		t.Fatalf("reads %d, want 1: only after the first acknowledgement", f.reads)
	}
	var fs []string
	for _, e := range readHistoryFile(t, path) {
		if e.Type != schema.HistoryInvoke {
			fs = append(fs, e.F+" "+string(e.Type))
		}
	}
	want := []string{"api_action ok", "api_read ok", "api_action info", "api_action ok"}
	if strings.Join(fs, ",") != strings.Join(want, ",") {
		t.Fatalf("history %v, want %v", fs, want)
	}
}

func TestPlansWithAPIOperations(t *testing.T) {
	dir := t.TempDir()
	write := func(body string) params {
		p := params{plan: filepath.Join(dir, "plan.json"), history: filepath.Join(dir, "h.jsonl"), profile: "api", seed: 7}
		if err := os.WriteFile(p.plan, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	ok := `{"schema":"prothesis.driver_plan/v1","profile":"api","seed":7,"clients":2,"ops":10,"mix":[{"op":"api_action","weight_ppm":900000},{"op":"sync","weight_ppm":100000}]}`
	pl, err := loadPlan(write(ok))
	if err != nil || !usesPeople(pl) || !planUses(pl, opAPIAction) {
		t.Fatalf("a plan with api_action: %v", err)
	}
	replay := `{"schema":"prothesis.driver_plan/v1","profile":"api","seed":7,"clients":1,"ops":2,"mix":[],"operations":[` +
		`{"op_id":1,"process":0,"f":"api_action","key":"person/hr:Person/E-0101","at_ms":0},` +
		`{"op_id":2,"process":0,"f":"api_read","key":"person/hr:Person/E-0101","at_ms":10}]}`
	if _, err := loadPlan(write(replay)); err != nil {
		t.Fatalf("a replay of api operations: %v", err)
	}
	bad := `{"schema":"prothesis.driver_plan/v1","profile":"api","seed":7,"clients":1,"ops":1,"mix":[],"operations":[` +
		`{"op_id":1,"process":0,"f":"api_read","key":"mapping/3","at_ms":0}]}`
	if _, err := loadPlan(write(bad)); err == nil {
		t.Fatal("an api_read keyed by a mapping was accepted")
	}
}
