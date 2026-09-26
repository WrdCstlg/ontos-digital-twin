// Command oracle-api is the `api.read_your_writes` oracle for the Ontos gate.
//
// Invariant: every action submission acknowledged through the Ontology API
// (/api/v1) is visible, as applied, to the next read of its objects through
// /api/v1. ontosload records each acknowledged `api_action` with its submission
// id and the note it wrote, and has the same client read the person back at
// once (`api_read`): whether the person was found, the submission its source
// names as its last change, and its gate note.
//
// Submissions to one person commit in the order of their ids: each locks the
// person, and one that finds it changed since it planned plans again under a
// new id. So for an acknowledged submission S and its client's next read:
//
//	the person not found                      violated (not_visible)
//	no submission named, or one before S      violated (stale_read)
//	S named, but another note held            violated (wrong_value)
//	a later submission named                  another write came between: its
//	                                          note is checked when the history
//	                                          holds it (an acknowledged
//	                                          api_action), and excused otherwise
//
// A read that did not answer (fail or info) or was not made judges nothing.
//
// It reads only the history. A world with no api_action judges nothing and
// says so, as actions.delivered does in a world without actions; a world whose
// api_actions none were judged is inconclusive, and so is a history it cannot
// read: fail closed.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const (
	oracleName  = "api.read_your_writes"
	opAPIAction = "api_action"
	opAPIRead   = "api_read"
)

type verdict struct {
	status      schema.OracleStatus
	witness     schema.Witness
	explanation string
}

func inconclusive(format string, args ...interface{}) verdict {
	return verdict{status: schema.StatusInconclusive, explanation: fmt.Sprintf(format, args...)}
}

func main() {
	if len(os.Args) > 1 {
		finish(inconclusive("oracle-api takes no arguments, got %q", strings.Join(os.Args[1:], " ")))
	}
	finish(evaluate(os.Stdin))
}

// finish prints the document and exits with the code that agrees with it.
func finish(v verdict) {
	out := schema.OracleOutput{
		Oracle:      oracleName,
		Class:       schema.ClassConsistency,
		ValidPhases: []schema.Phase{"ASSERT"},
		Status:      v.status,
		Witness:     v.witness,
		Explanation: v.explanation,
	}
	b, err := schema.MarshalOracleOutput(&out)
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode output:", err)
		os.Exit(int(schema.OracleExitInconclusive))
	}
	os.Stdout.Write(b)
	switch v.status {
	case schema.StatusOK:
		os.Exit(int(schema.OracleExitOK))
	case schema.StatusViolated:
		os.Exit(int(schema.OracleExitViolated))
	default:
		os.Exit(int(schema.OracleExitInconclusive))
	}
}

func evaluate(stdin io.Reader) verdict {
	raw, err := io.ReadAll(io.LimitReader(stdin, 1<<20))
	if err != nil {
		return inconclusive("could not read the oracle input: %v", err)
	}
	in, err := schema.UnmarshalOracleInput(raw)
	if err != nil {
		return inconclusive("%v", err)
	}
	f, err := os.Open(in.HistoryPath)
	if err != nil {
		return inconclusive("open history: %v", err)
	}
	defer f.Close()
	var entries []schema.HistoryEntry
	r := schema.NewHistoryReader(f)
	for {
		e, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return inconclusive("history is malformed, so it cannot be trusted: %v", err)
		}
		entries = append(entries, *e)
	}
	return judge(entries)
}

// ack is an acknowledged api_action: what the driver was told was applied.
type ack struct {
	OpID       int64  `json:"action_op_id"`
	Key        string `json:"key"`
	Submission int64  `json:"submission"`
	Note       string `json:"note"`
}

// seen is what an api_read saw.
type seen struct {
	Found        bool    `json:"found"`
	SubmissionID *int64  `json:"submissionId"`
	GateNote     *string `json:"gateNote"`
}

type finding struct {
	Kind           string  `json:"kind"`
	Key            string  `json:"key"`
	ActionOpID     int64   `json:"action_op_id"`
	ReadOpID       int64   `json:"read_op_id"`
	Submission     int64   `json:"acknowledged_submission"`
	ReadSubmission *int64  `json:"read_submission"`
	Note           string  `json:"acknowledged_note"`
	ReadNote       *string `json:"read_note"`
	TMS            int64   `json:"t_ms"`
}

type pair struct {
	ack      ack
	readOpID int64
	read     *seen // nil: the read did not answer
	tMS      int64
}

func opID(e *schema.HistoryEntry) int64 {
	if e.OpID != nil {
		return *e.OpID
	}
	return 0
}

func judge(entries []schema.HistoryEntry) verdict {
	var driveNS int64
	invoked := 0
	var acks []ack
	notes := map[int64]string{}
	// By client and person: the client's latest acknowledged write to that person,
	// until the client next reads the person.
	type clientKey struct {
		proc int64
		key  string
	}
	pending := map[clientKey]*ack{}
	var pairs []pair
	unpaired := 0

	for i := range entries {
		e := &entries[i]
		if e.RecordKind() == schema.RecordMarker {
			if e.Event == schema.EventPhase && e.Phase == "DRIVE" && driveNS == 0 {
				driveNS = e.TNS
			}
			continue
		}
		if e.RecordKind() != schema.RecordOperation || (e.F != opAPIAction && e.F != opAPIRead) {
			continue
		}
		proc := int64(-1)
		if e.Process != nil {
			proc = *e.Process
		}
		key := ""
		if e.Key != nil {
			key = *e.Key
		}
		if e.Type == schema.HistoryInvoke {
			if e.F == opAPIAction {
				invoked++
			}
			continue
		}
		switch e.F {
		case opAPIAction:
			if e.Type != schema.HistoryOK {
				continue
			}
			var a ack
			if err := json.Unmarshal(e.Value, &a); err != nil || a.Submission <= 0 {
				return inconclusive("api_action op %d was acknowledged with a value that names no submission (%s), so the history cannot be trusted", opID(e), string(e.Value))
			}
			a.OpID, a.Key = opID(e), key
			acks = append(acks, a)
			notes[a.Submission] = a.Note
			pending[clientKey{proc, key}] = &a
		case opAPIRead:
			ck := clientKey{proc, key}
			a := pending[ck]
			delete(pending, ck)
			if a == nil {
				unpaired++
				continue
			}
			p := pair{ack: *a, readOpID: opID(e)}
			if driveNS > 0 {
				p.tMS = (e.TNS - driveNS) / 1_000_000
			}
			if e.Type == schema.HistoryOK {
				var s seen
				if err := json.Unmarshal(e.Value, &s); err != nil {
					return inconclusive("api_read op %d answered with a value that cannot be read (%s), so the history cannot be trusted", opID(e), string(e.Value))
				}
				p.read = &s
			}
			pairs = append(pairs, p)
		}
	}

	if invoked == 0 {
		return verdict{status: schema.StatusOK, explanation: "judged nothing: this world made no submission through the Ontology API."}
	}

	var findings []finding
	own, later, excused, unjudged := 0, 0, 0, 0
	for _, p := range pairs {
		if p.read == nil {
			unjudged++
			continue
		}
		a, s := p.ack, p.read
		f := finding{Key: a.Key, ActionOpID: a.OpID, ReadOpID: p.readOpID, Submission: a.Submission, ReadSubmission: s.SubmissionID, Note: a.Note, ReadNote: s.GateNote, TMS: p.tMS}
		switch {
		case !s.Found:
			f.Kind = "not_visible"
		case s.SubmissionID == nil || *s.SubmissionID < a.Submission:
			f.Kind = "stale_read"
		case *s.SubmissionID == a.Submission:
			own++
			if s.GateNote == nil || *s.GateNote != a.Note {
				f.Kind = "wrong_value"
			}
		default:
			later++
			if note, known := notes[*s.SubmissionID]; known {
				if s.GateNote == nil || *s.GateNote != note {
					f.Kind = "wrong_value"
				}
			} else {
				excused++
			}
		}
		if f.Kind != "" {
			findings = append(findings, f)
		}
	}
	judged := len(pairs) - unjudged
	unjudged += len(acks) - len(pairs)
	summary := fmt.Sprintf("%d submission(s) through the API, %d acknowledged; %d judged by the client's next read (%d saw their own write, %d a later one, %d of those by a write the history does not name), %d not judged",
		invoked, len(acks), judged, own, later, excused, unjudged)
	if unpaired > 0 {
		summary += fmt.Sprintf("; %d read(s) followed no acknowledgement", unpaired)
	}

	if len(findings) > 0 {
		sort.SliceStable(findings, func(i, j int) bool { return findings[i].TMS < findings[j].TMS })
		w := schema.Witness{Key: "api", Extra: map[string]json.RawMessage{}}
		b, _ := json.Marshal(findings)
		w.Extra["findings"] = b
		w.Extra["phase"] = json.RawMessage(`"DRIVE"`)
		if driveNS > 0 {
			t, _ := json.Marshal(findings[0].TMS)
			w.Extra["first_seen_ms"] = t
		}
		kinds := map[string]int{}
		for _, f := range findings {
			kinds[f.Kind]++
		}
		names := make([]string, 0, len(kinds))
		for k, n := range kinds {
			names = append(names, fmt.Sprintf("%s %d", k, n))
		}
		sort.Strings(names)
		first := findings[0]
		return verdict{status: schema.StatusViolated, witness: w, explanation: fmt.Sprintf(
			"a client did not read back what the Ontology API had acknowledged (%s). First, at t+%dms: submission %d on %s was acknowledged, and the next read found %s. %s.",
			strings.Join(names, ", "), first.TMS, first.Submission, first.Key, describe(first), summary)}
	}
	if judged == 0 {
		return inconclusive("no acknowledged submission through the Ontology API was followed by a read that answered, so read-your-writes was not tested: %s.", summary)
	}
	return verdict{status: schema.StatusOK, explanation: "every acknowledged submission through the Ontology API was visible, as applied, to the client's next read: " + summary + "."}
}

func describe(f finding) string {
	switch f.Kind {
	case "not_visible":
		return "no such object"
	case "stale_read":
		if f.ReadSubmission == nil {
			return "an object naming no submission as its last change"
		}
		return fmt.Sprintf("an object naming the earlier submission %d as its last change", *f.ReadSubmission)
	default: // wrong_value: a submission is named, since only then is a note compared
		note := "no note"
		if f.ReadNote != nil {
			note = fmt.Sprintf("note %q", *f.ReadNote)
		}
		return fmt.Sprintf("submission %d named as its last change, but %s", *f.ReadSubmission, note)
	}
}
