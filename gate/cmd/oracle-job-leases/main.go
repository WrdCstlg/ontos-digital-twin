// Command oracle-job-leases is the `jobs.lease_lapse` oracle for the Ontos gate.
//
// Invariant: a worker that was asked to stop never leaves its job to the lease.
// On SIGTERM a worker records in the `workers` table that it is stopping, then
// finishes its job within its grace or hands it back to the queue. A job whose
// lease lapsed on a worker that had recorded one of the --asked-to-stop statuses
// means that worker died holding the job: the job waited out the lease and was
// imported again from the start by another worker. The queue recovers either
// way, so only this oracle tells the two apart. A lease that lapsed on a worker
// still recorded as running is excused: that worker went silent without being
// asked to stop (frozen, killed, or hung), which is what leases are for.
//
// Everything it judges is Ontos's own record. The world file would say which
// nodes the world disturbed, but at v0.1.0-phase0 the harness writes it after
// the oracles run.
//
// The jobs table records only each job's latest attempt reason, so a lapse
// followed by a failed retry is not seen. When this oracle fires it is right;
// when it passes, a lapse hidden that way remains possible.
//
// Like sync_jobs.settle it reads MySQL through `docker exec` into the node `db`
// container, and it waits up to --settle for every job to finish first, since
// a lease can lapse after ASSERT begins. Fail closed: whatever it cannot
// establish is `inconclusive`, never `ok`.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const (
	oracleName     = "jobs.lease_lapse"
	nodeLabel      = "io.prothesis.node"
	pollInterval   = time.Second
	queryTimeout   = 10 * time.Second
	lapsedPrefix   = "lease held by "
	lapsedPattern  = lapsedPrefix + "% expired%"
	unsettledCount = "SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'running')"
	workersSQL     = "SELECT id, status FROM workers ORDER BY id"
)

// jobsSQL returns, per job, the worker whose lease lapsed: from the reason the
// queue wrote when it reclaimed or abandoned the job, or, for a job still
// running on an expired lease, from its current owner.
var jobsSQL = "SELECT id, status, attempts, CASE " +
	"WHEN lastError LIKE '" + lapsedPattern + "' " +
	"THEN SUBSTRING_INDEX(SUBSTRING(lastError, " + strconv.Itoa(len(lapsedPrefix)+1) + "), ' ', 1) " +
	"WHEN status = 'running' AND leaseExpiresAt < now() THEN IFNULL(leaseOwner, '?') " +
	"ELSE '' END FROM jobs ORDER BY id"

func main() {
	fs := flag.NewFlagSet(oracleName, flag.ContinueOnError)
	node := fs.String("node", "", "node id of the MySQL container (required)")
	settle := fs.Duration("settle", 0, "how long to wait for queued and running jobs to finish before judging (required)")
	askedFlag := fs.String("asked-to-stop", "", "comma-separated worker statuses that mean the worker was asked to stop (required)")
	if err := fs.Parse(os.Args[1:]); err != nil {
		finish(inconclusive("bad arguments: %v", err))
	}
	if *node == "" || *settle <= 0 || *askedFlag == "" {
		finish(inconclusive("--node, a positive --settle and --asked-to-stop are required"))
	}
	asked := map[string]bool{}
	for _, s := range strings.Split(*askedFlag, ",") {
		s = strings.TrimSpace(s)
		if s != "stopping" && s != "stopped" {
			finish(inconclusive("--asked-to-stop names %q; only stopping and stopped mean a worker was asked to stop", s))
		}
		asked[s] = true
	}
	finish(evaluate(*node, *settle, asked))
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
		Class:       schema.ClassSafety,
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

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------

type lapse struct {
	jobID       int64
	status      string
	attempts    int64
	owner       string
	ownerStatus string
	node        string
}

func evaluate(dbNode string, settle time.Duration, asked map[string]bool) verdict {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err != nil {
		return inconclusive("could not read the oracle input: %v", err)
	}
	if _, err := schema.UnmarshalOracleInput(raw); err != nil {
		return inconclusive("%v", err)
	}

	db, err := findContainer(dbNode)
	if err != nil {
		return inconclusive("%v", err)
	}

	// A lease can lapse after ASSERT begins, so judge once the jobs have
	// finished, or at the deadline with what is visible then.
	settled := false
	deadline := time.Now().Add(settle)
	for {
		n, err := mysqlOne(db, unsettledCount)
		if err != nil {
			fmt.Fprintf(os.Stderr, "query failed: %v\n", err)
		} else if n == "0" {
			settled = true
			break
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(pollInterval)
	}

	rows, err := mysqlRows(db, jobsSQL, 4)
	if err != nil {
		return inconclusive("the jobs table could not be read: %v", err)
	}
	if len(rows) == 0 {
		return inconclusive("the jobs table is empty: no job ran, so there is no lease to judge")
	}
	workerRows, err := mysqlRows(db, workersSQL, 2)
	if err != nil {
		return inconclusive("the workers table could not be read: %v", err)
	}
	workerStatus := map[string]string{}
	for _, w := range workerRows {
		workerStatus[w[0]] = w[1]
	}

	var excused, violations []lapse
	for _, r := range rows {
		if r[3] == "" {
			continue
		}
		id, err1 := strconv.ParseInt(r[0], 10, 64)
		attempts, err2 := strconv.ParseInt(r[2], 10, 64)
		if err1 != nil || err2 != nil {
			return inconclusive("unexpected jobs row %q", strings.Join(r, "\t"))
		}
		l := lapse{jobID: id, status: r[1], attempts: attempts, owner: r[3], node: ownerNode(r[3])}
		st, ok := workerStatus[l.owner]
		if !ok {
			return inconclusive("job %d's lease lapsed on %q, which has no row in workers, so whether it was asked "+
				"to stop cannot be told", id, l.owner)
		}
		l.ownerStatus = st
		if asked[st] {
			violations = append(violations, l)
		} else {
			excused = append(excused, l)
		}
	}

	note := ""
	if !settled {
		note = fmt.Sprintf(" Some jobs were still queued or running after %s; judged on what was visible then.", settle)
	}
	if len(violations) > 0 {
		return violated(violations, len(rows), note)
	}
	if len(excused) == 0 {
		return verdict{status: schema.StatusOK, explanation: fmt.Sprintf(
			"no lease lapsed across %d job(s).%s", len(rows), note)}
	}
	return verdict{status: schema.StatusOK, explanation: fmt.Sprintf(
		"%d of %d job(s) recovered from a lapsed lease, all on workers that went silent without being asked "+
			"to stop (%s).%s", len(excused), len(rows), describe(excused), note)}
}

func violated(ls []lapse, total int, note string) verdict {
	entries := make([]map[string]interface{}, 0, len(ls))
	ids := make([]string, 0, len(ls))
	for _, l := range ls {
		entries = append(entries, map[string]interface{}{
			"job_id": l.jobID, "status": l.status, "attempts": l.attempts,
			"lease_owner": l.owner, "owner_status": l.ownerStatus, "node": l.node,
		})
		ids = append(ids, strconv.FormatInt(l.jobID, 10))
	}
	w := schema.Witness{Key: "jobs", Extra: map[string]json.RawMessage{}}
	w.Extra["lapsed_leases"] = mustJSON(entries)
	w.Extra["phase"] = mustJSON("ASSERT")
	return verdict{
		status:  schema.StatusViolated,
		witness: w,
		explanation: fmt.Sprintf("%d of %d job(s) (job %s) recovered only because a lease lapsed on a worker that "+
			"had recorded it was asked to stop (%s). Such a worker finishes its job or hands it back; a lapsed "+
			"lease means it died holding the job, which then waited out the lease and ran again from the start.%s",
			len(ls), total, strings.Join(ids, ", "), describe(ls), note),
	}
}

// describe names each distinct worker as "node (worker id, status)".
func describe(ls []lapse) string {
	seen := map[string]bool{}
	var out []string
	for _, l := range ls {
		if seen[l.owner] {
			continue
		}
		seen[l.owner] = true
		out = append(out, fmt.Sprintf("%s (%s, %s)", l.node, l.owner, l.ownerStatus))
	}
	sort.Strings(out)
	return strings.Join(out, "; ")
}

func mustJSON(v interface{}) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return b
}

// ---------------------------------------------------------------------------
// Docker and MySQL
// ---------------------------------------------------------------------------

// ownerNode names the node a worker id belongs to, for the explanation only.
// The id starts with the worker's hostname, which Docker sets to the
// container's short id, and a restarted container keeps its id.
func ownerNode(owner string) string {
	host, _, ok := strings.Cut(owner, "-")
	if !ok || host == "" {
		return "unknown node"
	}
	out, err := docker(context.Background(), "inspect", "--type", "container",
		"--format", `{{index .Config.Labels "`+nodeLabel+`"}}`, host)
	if err != nil || strings.TrimSpace(out) == "" {
		return "unknown node"
	}
	return strings.TrimSpace(out)
}

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

func mysql(container, query string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	// The SQL travels as a positional argument, so no shell quoting touches it.
	return docker(ctx, "exec", container, "sh", "-c",
		`MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" `+
			`--batch --skip-column-names --execute="$1"`, "sh", query)
}

func mysqlOne(container, query string) (string, error) {
	out, err := mysql(container, query)
	return strings.TrimSpace(out), err
}

func mysqlRows(container, query string, cols int) ([][]string, error) {
	out, err := mysql(container, query)
	if err != nil {
		return nil, err
	}
	var rows [][]string
	// Split without trimming the whole output: a last column that is empty
	// leaves the row ending in a tab.
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		r := strings.Split(line, "\t")
		if len(r) != cols {
			return nil, fmt.Errorf("unexpected row %q", line)
		}
		rows = append(rows, r)
	}
	return rows, nil
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
