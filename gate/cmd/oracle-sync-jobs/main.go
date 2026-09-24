// Command oracle-sync-jobs is the `sync_jobs.settle` oracle for the Ontos gate.
//
// Invariant: once the system has healed and gone quiet, no sync job still
// claims to be running. mapping.runSync records its job as `running` before it
// imports anything, and every job must end `succeeded` or `failed`. A job
// still `running` after the settle window is one no process will finish: the
// job list will report it as in progress forever.
//
// The harness's final_state carries no target data, so this reads MySQL
// directly, through `docker exec` into the container the harness labels as
// node `db`, with the credentials already in that container's environment.
// An import may outlive the driver's request by a few seconds (a request that
// timed out is still being served), so it polls for up to --settle before it
// judges.
//
// Fail closed: whatever it cannot establish (no history, no import that ever
// completed, no reachable database, an ambiguous container) is `inconclusive`,
// never `ok`.
package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"encoding/json"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const (
	oracleName   = "sync_jobs.settle"
	nodeLabel    = "io.prothesis.node"
	pollInterval = time.Second
	queryTimeout = 10 * time.Second
)

func main() {
	fs := flag.NewFlagSet(oracleName, flag.ContinueOnError)
	node := fs.String("node", "", "node id of the MySQL container (required)")
	settle := fs.Duration("settle", 0, "how long running jobs may take to finish (required)")
	if err := fs.Parse(os.Args[1:]); err != nil {
		finish(inconclusive("bad arguments: %v", err))
	}
	if *node == "" || *settle <= 0 {
		finish(inconclusive("--node and a positive --settle are required"))
	}
	finish(evaluate(*node, *settle))
}

type verdict struct {
	status      schema.OracleStatus
	witness     schema.Witness
	explanation string
}

func inconclusive(format string, args ...interface{}) verdict {
	return verdict{status: schema.StatusInconclusive, explanation: fmt.Sprintf(format, args...)}
}

// finish prints the document and exits with the code that agrees with it.
func finish(v verdict) {
	out := schema.OracleOutput{
		Oracle:      oracleName,
		Class:       schema.ClassLiveness,
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

func evaluate(node string, settle time.Duration) verdict {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err != nil {
		return inconclusive("could not read the oracle input: %v", err)
	}
	in, err := schema.UnmarshalOracleInput(raw)
	if err != nil {
		return inconclusive("%v", err)
	}

	h, err := readHistory(in.HistoryPath)
	if err != nil {
		return inconclusive("%v", err)
	}
	if h.syncInvokes == 0 {
		return inconclusive("the history holds no sync operation, so no import was attempted and there is no job to judge")
	}
	if h.syncOK == 0 {
		return inconclusive("none of %d sync operations completed ok, so no import ran end to end; "+
			"a missing stuck job here would prove nothing", h.syncInvokes)
	}

	container, err := findContainer(node)
	if err != nil {
		return inconclusive("%v", err)
	}

	deadline := time.Now().Add(settle)
	var last *jobTable
	var lastErr error
	for {
		jobs, err := queryJobs(container)
		if err != nil {
			lastErr = err
			fmt.Fprintf(os.Stderr, "query failed: %v\n", err)
		} else {
			last = jobs
			if len(jobs.running) == 0 {
				return verdict{
					status: schema.StatusOK,
					explanation: fmt.Sprintf("no sync job is left running: %s. The driver recorded %s.",
						jobs.summary(), h.summary()),
				}
			}
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(pollInterval)
	}
	if last == nil {
		return inconclusive("the sync_jobs table could not be read within %s: %v", settle, lastErr)
	}
	return violated(last, h, settle)
}

func violated(jobs *jobTable, h *historyFacts, settle time.Duration) verdict {
	stuck := make([]map[string]int64, 0, len(jobs.running))
	ids := make([]string, 0, len(jobs.running))
	for _, j := range jobs.running {
		entry := map[string]int64{"job_id": j.id, "mapping_id": j.mappingID}
		if h.driveStartNS > 0 && j.startedUnix > 0 {
			entry["started_ms"] = j.startedUnix*1000 - h.driveStartNS/int64(time.Millisecond)
		}
		stuck = append(stuck, entry)
		ids = append(ids, strconv.FormatInt(j.id, 10))
	}
	w := schema.Witness{Key: "sync_jobs", Extra: map[string]json.RawMessage{}}
	w.Extra["stuck_jobs"] = mustJSON(stuck)
	w.Extra["settle_ms"] = mustJSON(settle.Milliseconds())
	w.Extra["indeterminate_sync_op_ids"] = mustJSON(h.infoOpIDs)
	w.Extra["phase"] = mustJSON("ASSERT")
	if h.driveStartNS > 0 {
		w.Extra["first_seen_ms"] = mustJSON((time.Now().UnixNano() - h.driveStartNS) / int64(time.Millisecond))
	}
	return verdict{
		status:  schema.StatusViolated,
		witness: w,
		explanation: fmt.Sprintf("%d sync job(s) still claim to be running %s after the system went quiet "+
			"(job %s). %s. The driver recorded %s; %d sync operation(s) ended indeterminate, which is where "+
			"an import was cut off. Nothing will ever finish these jobs: the job list will show them in "+
			"progress indefinitely.",
			len(jobs.running), settle, strings.Join(ids, ", "), jobs.summary(), h.summary(), len(h.infoOpIDs)),
	}
}

func mustJSON(v interface{}) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return b
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

type historyFacts struct {
	driveStartNS                        int64
	syncInvokes                         int
	syncOK, syncFail, syncInfo, unended int
	infoOpIDs                           []int64
}

func (h *historyFacts) summary() string {
	return fmt.Sprintf("%d sync operations (ok %d, fail %d, info %d, never completed %d)",
		h.syncInvokes, h.syncOK, h.syncFail, h.syncInfo, h.unended)
}

// readHistory takes what this oracle needs from the merged history. A
// malformed line makes the whole history untrustworthy, so it refuses.
func readHistory(path string) (*historyFacts, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open history: %w", err)
	}
	defer f.Close()
	r := schema.NewHistoryReader(f)
	facts := &historyFacts{infoOpIDs: []int64{}}
	open := map[int64]bool{}
	for {
		e, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("history is malformed, so it cannot be trusted: %w", err)
		}
		if e.RecordKind() == schema.RecordMarker {
			if e.Event == schema.EventPhase && e.Phase == "DRIVE" && facts.driveStartNS == 0 {
				facts.driveStartNS = e.TNS
			}
			continue
		}
		if e.F != "sync" || e.OpID == nil {
			continue
		}
		switch e.Type {
		case schema.HistoryInvoke:
			facts.syncInvokes++
			open[*e.OpID] = true
		case schema.HistoryOK:
			facts.syncOK++
			delete(open, *e.OpID)
		case schema.HistoryFail:
			facts.syncFail++
			delete(open, *e.OpID)
		case schema.HistoryInfo:
			facts.syncInfo++
			facts.infoOpIDs = append(facts.infoOpIDs, *e.OpID)
			delete(open, *e.OpID)
		}
	}
	facts.unended = len(open)
	sort.Slice(facts.infoOpIDs, func(i, j int) bool { return facts.infoOpIDs[i] < facts.infoOpIDs[j] })
	return facts, nil
}

// ---------------------------------------------------------------------------
// MySQL, through the db container
// ---------------------------------------------------------------------------

// findContainer resolves the running container the harness labelled with the
// node id. More than one match (a stale world, a parallel run) is ambiguous.
func findContainer(node string) (string, error) {
	out, err := docker(context.Background(), "ps", "--filter", "label="+nodeLabel+"="+node,
		"--filter", "status=running", "--format", "{{.ID}}")
	if err != nil {
		return "", fmt.Errorf("cannot list containers: %v", err)
	}
	ids := strings.Fields(out)
	switch len(ids) {
	case 1:
		return ids[0], nil
	case 0:
		return "", fmt.Errorf("no running container carries %s=%s, so the database cannot be read", nodeLabel, node)
	default:
		return "", fmt.Errorf("%d running containers carry %s=%s (%s); refusing to guess which world's database to read",
			len(ids), nodeLabel, node, strings.Join(ids, ", "))
	}
}

type job struct {
	id, mappingID, startedUnix int64
	status                     string
}

type jobTable struct {
	all     []job
	running []job
}

func (t *jobTable) summary() string {
	byStatus := map[string]int{}
	for _, j := range t.all {
		byStatus[j.status]++
	}
	keys := make([]string, 0, len(byStatus))
	for k := range byStatus {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", k, byStatus[k]))
	}
	return fmt.Sprintf("sync_jobs holds %d row(s): %s", len(t.all), strings.Join(parts, ", "))
}

const jobsSQL = "SELECT id, mappingId, status, IFNULL(UNIX_TIMESTAMP(startedAt), 0) FROM sync_jobs ORDER BY id"

func queryJobs(container string) (*jobTable, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	// The SQL travels as a positional argument, so no shell quoting touches it.
	out, err := docker(ctx, "exec", container, "sh", "-c",
		`MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" `+
			`--batch --skip-column-names --execute="$1"`, "sh", jobsSQL)
	if err != nil {
		return nil, err
	}
	t := &jobTable{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		cols := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(cols) != 4 {
			return nil, fmt.Errorf("unexpected row %q", line)
		}
		id, err1 := strconv.ParseInt(cols[0], 10, 64)
		mid, err2 := strconv.ParseInt(cols[1], 10, 64)
		started, err3 := strconv.ParseFloat(cols[3], 64)
		if err1 != nil || err2 != nil || err3 != nil {
			return nil, fmt.Errorf("unexpected row %q", line)
		}
		j := job{id: id, mappingID: mid, status: cols[2], startedUnix: int64(started)}
		t.all = append(t.all, j)
		if j.status == "running" {
			t.running = append(t.running, j)
		}
	}
	if len(t.all) == 0 {
		return nil, errors.New("sync_jobs is empty, which the seed never leaves it; this is not the gate database")
	}
	return t, nil
}

func docker(ctx context.Context, args ...string) (string, error) {
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("docker %s: %v: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
