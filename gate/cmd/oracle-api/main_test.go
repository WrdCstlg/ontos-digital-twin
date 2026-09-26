package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

// hist builds histories as ontosload writes them.
type hist struct {
	entries []schema.HistoryEntry
	t       int64
	next    int64
}

func (h *hist) drive() *hist {
	h.t++
	h.entries = append(h.entries, schema.HistoryEntry{TNS: h.t * 1_000_000, Type: schema.HistoryInfo, Event: schema.EventPhase, Phase: "DRIVE"})
	return h
}

func (h *hist) op(proc int64, f, key string, kind schema.HistoryType, value string) *hist {
	h.next++
	id := h.next
	p := proc
	k := key
	h.t++
	h.entries = append(h.entries, schema.HistoryEntry{TNS: h.t * 1_000_000, Process: &p, Type: schema.HistoryInvoke, F: f, Key: &k, OpID: &id})
	h.t++
	e := schema.HistoryEntry{TNS: h.t * 1_000_000, Process: &p, Type: kind, F: f, Key: &k, OpID: &id}
	if value != "" {
		e.Value = json.RawMessage(value)
	}
	if kind != schema.HistoryOK {
		e.Error = "indeterminate: HTTP 503 unavailable: retry"
	}
	h.entries = append(h.entries, e)
	return h
}

// written is an acknowledged api_action; readBack is the read that follows it.
func (h *hist) written(proc int64, person string, submission int, note string) *hist {
	return h.op(proc, opAPIAction, "person/"+person, schema.HistoryOK, `{"submission":`+itoa(submission)+`,"note":"`+note+`"}`)
}

func (h *hist) readBack(proc int64, person string, found bool, submission *int, note *string) *hist {
	v := map[string]any{"found": found, "submissionId": submission, "gateNote": note}
	b, _ := json.Marshal(v)
	return h.op(proc, opAPIRead, "person/"+person, schema.HistoryOK, string(b))
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }
func ip(n int) *int     { return &n }
func sp(s string) *string {
	return &s
}

const p1 = "hr:Person/E-0101"

func TestNoAPIWritesJudgesNothing(t *testing.T) {
	h := (&hist{}).drive().op(0, "sync", "mapping/1", schema.HistoryOK, "7").op(1, "action", "person/"+p1, schema.HistoryOK, "12")
	v := judge(h.entries)
	if v.status != schema.StatusOK || !strings.Contains(v.explanation, "judged nothing") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestReadingBackOwnWriteIsOK(t *testing.T) {
	h := (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(40), sp("n0"))
	v := judge(h.entries)
	if v.status != schema.StatusOK || !strings.Contains(v.explanation, "1 judged") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestStaleReadsAreViolations(t *testing.T) {
	for name, h := range map[string]*hist{
		"an earlier submission": (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(39), sp("old")),
		"no submission at all":  (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, nil, nil),
	} {
		v := judge(h.entries)
		if v.status != schema.StatusViolated || !strings.Contains(v.explanation, "stale_read 1") {
			t.Fatalf("%s: %s: %s", name, v.status, v.explanation)
		}
		if !bytes.Contains(v.witness.Extra["findings"], []byte(`"acknowledged_submission":40`)) {
			t.Fatalf("%s: witness %s", name, v.witness.Extra["findings"])
		}
	}
}

func TestAWriteThatCannotBeFoundIsAViolation(t *testing.T) {
	h := (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, false, nil, nil)
	if v := judge(h.entries); v.status != schema.StatusViolated || !strings.Contains(v.explanation, "not_visible 1") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestTheRightSubmissionWithTheWrongNoteIsAViolation(t *testing.T) {
	h := (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(40), sp("someone else's"))
	if v := judge(h.entries); v.status != schema.StatusViolated || !strings.Contains(v.explanation, "wrong_value 1") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestALaterWriteInBetweenIsExcusedOrChecked(t *testing.T) {
	// Client 1's write lands between client 0's acknowledgement and its read,
	// and client 1's acknowledgement is recorded after that read.
	h := (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(41), sp("n1")).written(1, p1, 41, "n1").readBack(1, p1, true, ip(41), sp("n1"))
	if v := judge(h.entries); v.status != schema.StatusOK || !strings.Contains(v.explanation, "1 a later one") {
		t.Fatalf("known later write: %s: %s", v.status, v.explanation)
	}
	h = (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(41), sp("n9")).written(1, p1, 41, "n1")
	if v := judge(h.entries); v.status != schema.StatusViolated || !strings.Contains(v.explanation, "wrong_value 1") {
		t.Fatalf("a later write with the wrong note: %s: %s", v.status, v.explanation)
	}
	// A later write the history does not name (a tRPC action, or an info that applied): excused.
	h = (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(77), sp("whatever"))
	if v := judge(h.entries); v.status != schema.StatusOK || !strings.Contains(v.explanation, "1 of those by a write the history does not name") {
		t.Fatalf("unnamed later write: %s: %s", v.status, v.explanation)
	}
}

func TestReadsArePairedWithTheirOwnClient(t *testing.T) {
	// Two clients interleave; each read belongs to its own client's write.
	h := (&hist{}).drive().written(0, p1, 40, "n0").written(1, "hr:Person/E-0102", 41, "n1").
		readBack(1, "hr:Person/E-0102", true, ip(41), sp("n1")).readBack(0, p1, true, ip(40), sp("n0"))
	if v := judge(h.entries); v.status != schema.StatusOK || !strings.Contains(v.explanation, "2 judged") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
	// A read of another person follows no acknowledgement of that person.
	h = (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, "hr:Person/E-0199", true, ip(3), sp("x"))
	if v := judge(h.entries); v.status != schema.StatusInconclusive {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestAnUnacknowledgedWriteInBetweenExcusesNothing(t *testing.T) {
	// The client's acknowledged write must still show at its next read of the
	// person, though a submission it was never told about came between.
	h := (&hist{}).drive().written(0, p1, 40, "n0").op(0, opAPIAction, "person/"+p1, schema.HistoryInfo, "").readBack(0, p1, true, ip(39), sp("old"))
	if v := judge(h.entries); v.status != schema.StatusViolated || !strings.Contains(v.explanation, "stale_read 1") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
	// A read of another person in between leaves the check waiting for its person.
	h = (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, "hr:Person/E-0150", true, ip(5), sp("x")).readBack(0, p1, true, ip(40), sp("n0"))
	if v := judge(h.entries); v.status != schema.StatusOK || !strings.Contains(v.explanation, "1 judged") || !strings.Contains(v.explanation, "1 read(s) followed no acknowledgement") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestUnansweredReadsJudgeNothing(t *testing.T) {
	h := (&hist{}).drive().written(0, p1, 40, "n0").op(0, opAPIRead, "person/"+p1, schema.HistoryInfo, "")
	v := judge(h.entries)
	if v.status != schema.StatusInconclusive || !strings.Contains(v.explanation, "was not tested") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
	// Submissions that were never acknowledged judge nothing either.
	h = (&hist{}).drive().op(0, opAPIAction, "person/"+p1, schema.HistoryInfo, "").op(0, opAPIAction, "person/"+p1, schema.HistoryFail, "")
	if v := judge(h.entries); v.status != schema.StatusInconclusive {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
	// One unanswered read among answered ones: judged on the rest.
	h = (&hist{}).drive().written(0, p1, 40, "n0").op(0, opAPIRead, "person/"+p1, schema.HistoryInfo, "").written(0, p1, 42, "n2").readBack(0, p1, true, ip(42), sp("n2"))
	if v := judge(h.entries); v.status != schema.StatusOK || !strings.Contains(v.explanation, "1 judged") || !strings.Contains(v.explanation, "1 not judged") {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestAHistoryItCannotReadIsInconclusive(t *testing.T) {
	h := (&hist{}).drive().op(0, opAPIAction, "person/"+p1, schema.HistoryOK, `{"note":"no submission"}`)
	if v := judge(h.entries); v.status != schema.StatusInconclusive {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
	if v := evaluate(strings.NewReader("not an oracle input")); v.status != schema.StatusInconclusive {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
}

func TestEvaluateReadsTheHistoryTheHarnessNames(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.jsonl")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := schema.NewHistoryWriter(f)
	for _, e := range (&hist{}).drive().written(0, p1, 40, "n0").readBack(0, p1, true, ip(39), sp("old")).entries {
		e := e
		if err := w.Write(&e); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Flush(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	in := schema.NewOracleInput(path, filepath.Join(dir, "final.json"), filepath.Join(dir, "telemetry.jsonl"), filepath.Join(dir, "world.thesis"), schema.PhaseTimings{})
	raw, err := schema.MarshalOracleInput(&in)
	if err != nil {
		t.Fatal(err)
	}
	v := evaluate(bytes.NewReader(raw))
	if v.status != schema.StatusViolated {
		t.Fatalf("%s: %s", v.status, v.explanation)
	}
	if _, ok := v.witness.Extra["first_seen_ms"]; !ok {
		t.Fatal("the finding is not placed on the timeline")
	}
}
