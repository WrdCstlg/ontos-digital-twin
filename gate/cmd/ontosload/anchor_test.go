package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

// fakeImports answers mapping.runSync and operations.getJob as the app does:
// each import queues a job, and the job ends as `outcomes` says, in turn.
type fakeImports struct {
	mu       sync.Mutex
	outcomes []string // "succeeded", or "failed"
	queued   []string // the runSync bodies, in order
	jobs     int
}

func (f *fakeImports) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/api/trpc/mapping.runSync":
		body, _ := io.ReadAll(r.Body)
		f.queued = append(f.queued, string(body))
		f.jobs++
		_, _ = w.Write([]byte(`{"result":{"data":{"json":{"jobId":` + strconv.Itoa(f.jobs) + `}}}}`))
	case "/api/trpc/operations.getJob":
		status := f.outcomes[min(f.jobs, len(f.outcomes))-1]
		lastError := "null"
		if status == "failed" {
			lastError = `"the import broke"`
		}
		_, _ = w.Write([]byte(`{"result":{"data":{"json":{"status":"` + status + `","lastError":` + lastError + `}}}}`))
	default:
		http.NotFound(w, r)
	}
}

func anchorFixture(t *testing.T, outcomes ...string) (*fakeImports, *client, *history, string) {
	t.Helper()
	f := &fakeImports{outcomes: outcomes}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	c := newClient(srv.URL, 1)
	c.cookie = "ontos_session=s"
	path := filepath.Join(t.TempDir(), "history.jsonl")
	h, err := openHistory(path)
	if err != nil {
		t.Fatal(err)
	}
	return f, c, h, path
}

func completions(t *testing.T, path string) []schema.HistoryEntry {
	t.Helper()
	var out []schema.HistoryEntry
	for _, e := range readHistoryFile(t, path) {
		if e.Type != schema.HistoryInvoke {
			out = append(out, e)
		}
	}
	return out
}

func TestAnchorImportRunsOneSmallImportToTheEnd(t *testing.T) {
	f, c, h, path := anchorFixture(t, "succeeded")
	pools := map[string][]int64{opSync: {4, 1}, opSyncBulk: {7}}
	log := newLogger(filepath.Join(t.TempDir(), "driver.log"))
	defer log.close()
	var counts outcomeCounts

	if err := anchorImport(context.Background(), pools, c, h, newStopSignal(), &counts, log); err != nil {
		t.Fatalf("anchor: %v", err)
	}
	h.close()
	// The first small mapping, never a bulk fixture.
	if len(f.queued) != 1 || !strings.Contains(f.queued[0], `"mappingId":4`) {
		t.Fatalf("queued %v, want one import of mapping 4", f.queued)
	}
	got := completions(t, path)
	if len(got) != 1 || got[0].Type != schema.HistoryOK || got[0].F != opSync || got[0].Process == nil || *got[0].Process != 0 {
		t.Fatalf("history completions = %+v, want one ok sync by process 0", got)
	}
}

func TestAnchorImportGetsASecondChance(t *testing.T) {
	f, c, h, path := anchorFixture(t, "failed", "succeeded")
	log := newLogger(filepath.Join(t.TempDir(), "driver.log"))
	defer log.close()
	var counts outcomeCounts

	if err := anchorImport(context.Background(), map[string][]int64{opSync: {1}}, c, h, newStopSignal(), &counts, log); err != nil {
		t.Fatalf("anchor: %v", err)
	}
	h.close()
	if len(f.queued) != 2 {
		t.Fatalf("queued %d imports, want 2", len(f.queued))
	}
	got := completions(t, path)
	if len(got) != 2 || got[0].Type != schema.HistoryInfo || got[1].Type != schema.HistoryOK {
		t.Fatalf("history completions = %+v, want info then ok", got)
	}
}

func TestAnchorImportThatNeverSucceedsIsAnErrorThatSaysWhy(t *testing.T) {
	_, c, h, _ := anchorFixture(t, "failed", "failed")
	defer h.close()
	log := newLogger(filepath.Join(t.TempDir(), "driver.log"))
	defer log.close()
	var counts outcomeCounts

	err := anchorImport(context.Background(), map[string][]int64{opSync: {1}}, c, h, newStopSignal(), &counts, log)
	if err == nil || !strings.Contains(err.Error(), "did not succeed in 2 attempts") || !strings.Contains(err.Error(), "the import broke") {
		t.Fatalf("err = %v, want the attempts and the job's own error", err)
	}
}

func TestAnchorImportNeedsASmallMapping(t *testing.T) {
	_, c, h, _ := anchorFixture(t, "succeeded")
	defer h.close()
	log := newLogger(filepath.Join(t.TempDir(), "driver.log"))
	defer log.close()
	var counts outcomeCounts

	err := anchorImport(context.Background(), map[string][]int64{opSyncBulk: {7}}, c, h, newStopSignal(), &counts, log)
	if err == nil || !strings.Contains(err.Error(), "not a bulk fixture") {
		t.Fatalf("err = %v, want a refusal naming the missing small mapping", err)
	}
}
