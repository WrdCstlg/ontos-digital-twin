// Command oracle-job-leases is the `jobs.lease_lapse` oracle for the Ontos gate.
//
// Invariant: a job's lease lapses only on a worker the world froze or killed. A
// worker that is asked to stop (SIGTERM, which is what proc.restart sends) or
// is left alone either finishes its job or hands it back to the queue. A lease
// that lapsed on such a worker means it died holding the job: the job then
// waited out the lease and was imported again from the start by another
// worker. The queue recovers either way, so only this oracle tells the two
// apart.
//
// Which workers may lose a lease comes from the world file: the nodes of every
// realized fault other than proc.restart, and every worker when a fault touched
// the database (renewals cannot land while it is away). Each lapse is
// attributed to a node through its owner's id, which starts with the worker
// container's hostname, and so its short container id.
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

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const (
	oracleName     = "jobs.lease_lapse"
	nodeLabel      = "io.prothesis.node"
	projectLabel   = "com.docker.compose.project"
	pollInterval   = time.Second
	queryTimeout   = 10 * time.Second
	lapsedPrefix   = "lease held by "
	lapsedPattern  = lapsedPrefix + "% expired%"
	restartKind    = schema.FaultProcRestart
	unsettledCount = "SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'running')"
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
// the world's faults
// ---------------------------------------------------------------------------

type faults struct {
	realized  []string
	disturbed map[string]bool // nodes frozen, killed or otherwise disturbed
	allHit    bool            // a fault touched the database, so every worker may lose a lease
}

func (f *faults) excuses(node string) bool { return f.allHit || f.disturbed[node] }

func (f *faults) describe() string {
	if len(f.realized) == 0 {
		return "no fault"
	}
	return strings.Join(f.realized, ", ")
}

func readFaults(path, dbNode string) (*faults, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read world file: %w", err)
	}
	w, err := schema.UnmarshalWorld(raw)
	if err != nil {
		return nil, fmt.Errorf("world file: %w", err)
	}
	if w.FaultSchedule.Realized == nil {
		return nil, errors.New("the world file records no realized fault schedule, so it is not known which workers were disturbed")
	}
	f := &faults{realized: []string{}, disturbed: map[string]bool{}}
	for _, r := range w.FaultSchedule.Realized {
		spec, err := schema.ParseFault(r.Fault)
		if err != nil {
			return nil, fmt.Errorf("realized fault %q: %w", r.Fault, err)
		}
		f.realized = append(f.realized, r.Resolved)
		for _, n := range r.Nodes {
			if n == dbNode {
				f.allHit = true
			}
			if spec.Kind != restartKind {
				f.disturbed[n] = true
			}
		}
	}
	return f, nil
}

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------

type lapse struct {
	jobID    int64
	status   string
	attempts int64
	owner    string
	node     string
}

func evaluate(dbNode string, settle time.Duration) verdict {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err != nil {
		return inconclusive("could not read the oracle input: %v", err)
	}
	in, err := schema.UnmarshalOracleInput(raw)
	if err != nil {
		return inconclusive("%v", err)
	}
	f, err := readFaults(in.WorldPath, dbNode)
	if err != nil {
		return inconclusive("%v", err)
	}

	db, err := findContainer(dbNode)
	if err != nil {
		return inconclusive("%v", err)
	}
	project, err := containerLabel(db, projectLabel)
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
		l := lapse{jobID: id, status: r[1], attempts: attempts, owner: r[3]}
		l.node, err = ownerNode(l.owner, project)
		if err != nil {
			return inconclusive("job %d's lease lapsed on %q, which cannot be placed on a node: %v", id, l.owner, err)
		}
		if f.excuses(l.node) {
			excused = append(excused, l)
		} else {
			violations = append(violations, l)
		}
	}

	note := ""
	if !settled {
		note = fmt.Sprintf(" Some jobs were still queued or running after %s; judged on what was visible then.", settle)
	}
	if len(violations) > 0 {
		return violated(violations, f, len(rows), note)
	}
	if len(excused) == 0 {
		return verdict{status: schema.StatusOK, explanation: fmt.Sprintf(
			"no lease lapsed across %d job(s); this world had %s.%s", len(rows), f.describe(), note)}
	}
	return verdict{status: schema.StatusOK, explanation: fmt.Sprintf(
		"%d of %d job(s) recovered from a lapsed lease, all on nodes this world disturbed (%s: %s).%s",
		len(excused), len(rows), f.describe(), nodesOf(excused), note)}
}

func violated(ls []lapse, f *faults, total int, note string) verdict {
	entries := make([]map[string]interface{}, 0, len(ls))
	ids := make([]string, 0, len(ls))
	for _, l := range ls {
		entries = append(entries, map[string]interface{}{
			"job_id": l.jobID, "status": l.status, "attempts": l.attempts, "lease_owner": l.owner, "node": l.node,
		})
		ids = append(ids, strconv.FormatInt(l.jobID, 10))
	}
	w := schema.Witness{Key: "jobs", Extra: map[string]json.RawMessage{}}
	w.Extra["lapsed_leases"] = mustJSON(entries)
	w.Extra["realized_faults"] = mustJSON(f.realized)
	w.Extra["phase"] = mustJSON("ASSERT")
	return verdict{
		status:  schema.StatusViolated,
		witness: w,
		explanation: fmt.Sprintf("%d of %d job(s) (job %s) recovered only because a lease lapsed on %s, which this "+
			"world did not freeze or kill (it had %s). A worker that is asked to stop, or left alone, finishes its "+
			"job or hands it back; a lapsed lease means it died holding the job, which then waited out the lease "+
			"and ran again from the start.%s",
			len(ls), total, strings.Join(ids, ", "), nodesOf(ls), f.describe(), note),
	}
}

func nodesOf(ls []lapse) string {
	seen := map[string]bool{}
	var out []string
	for _, l := range ls {
		if !seen[l.node] {
			seen[l.node] = true
			out = append(out, l.node)
		}
	}
	sort.Strings(out)
	return strings.Join(out, ", ")
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

// ownerNode finds the node a worker id belongs to. The id starts with the
// worker's hostname, which Docker sets to the container's short id, and a
// restarted container keeps its id.
func ownerNode(owner, project string) (string, error) {
	host, _, ok := strings.Cut(owner, "-")
	if !ok || host == "" {
		return "", errors.New("the worker id has no hostname part")
	}
	node, err := containerLabel(host, nodeLabel)
	if err != nil {
		return "", err
	}
	if node == "" {
		return "", fmt.Errorf("container %s carries no %s label", host, nodeLabel)
	}
	p, err := containerLabel(host, projectLabel)
	if err != nil {
		return "", err
	}
	if p != project {
		return "", fmt.Errorf("container %s belongs to compose project %q, not this world's %q", host, p, project)
	}
	return node, nil
}

func containerLabel(container, label string) (string, error) {
	out, err := docker(context.Background(), "inspect", "--type", "container",
		"--format", `{{index .Config.Labels "`+label+`"}}`, container)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
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
