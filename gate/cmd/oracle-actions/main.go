// Command oracle-actions judges Ontos's action types. It serves two oracle
// definitions, chosen by --check:
//
// durable (`actions.durable`, safety): what an action did is exactly what was
// recorded. Every submission the driver saw applied is still applied; every
// submission, applied or rejected, has exactly one audit entry, and every
// audit entry for a submission has its submission; every object or link that
// names a submission as its source names an applied one; every applied
// gate-annotate submission queued its side effect; and each person's latest
// applied gate note is on the person, unless an import rewrote the person
// since (a documented limit: the person then names no submission).
// Submissions, their edits, their audit entries and their side-effect jobs are
// written in one transaction, so any of these failing means that transaction
// was not atomic or not durable.
//
// delivered (`actions.delivered`, liveness): every side-effect job of an
// applied submission ends succeeded within --settle. A job still queued or
// running, or failed for good, is a side effect that was never delivered.
//
// Both read MySQL through `docker exec` into the node `db` container, as
// sync_jobs.settle does. A world that submitted no actions is still judged by
// durable, over the submissions the seed recorded; delivered says it judged
// nothing. Fail closed: whatever cannot be established is `inconclusive`.
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
	nodeLabel    = "io.prothesis.node"
	pollInterval = time.Second
	queryTimeout = 10 * time.Second
	opAction     = "action"
	gateAction   = "gate-annotate"
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
	fs := flag.NewFlagSet("oracle-actions", flag.ContinueOnError)
	check := fs.String("check", "", "durable or delivered (required)")
	node := fs.String("node", "", "node id of the MySQL container (required)")
	settle := fs.Duration("settle", 0, "delivered: how long side-effect jobs may take to finish (required for delivered)")
	if err := fs.Parse(os.Args[1:]); err != nil {
		finish("actions", schema.ClassSafety, inconclusive("bad arguments: %v", err))
	}
	switch {
	case *check == "durable" && *node != "":
		finish("actions.durable", schema.ClassSafety, durable(*node))
	case *check == "delivered" && *node != "" && *settle > 0:
		finish("actions.delivered", schema.ClassLiveness, delivered(*node, *settle))
	default:
		finish("actions", schema.ClassSafety, inconclusive("--check durable --node, or --check delivered --node --settle, is required"))
	}
}

// finish prints the document and exits with the code that agrees with it.
func finish(name string, class schema.OracleClass, v verdict) {
	out := schema.OracleOutput{
		Oracle:      name,
		Class:       class,
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

/* ── history ─────────────────────────────────────────────────── */

type actionFacts struct {
	invokes, ok, fail, info int
	// acked are the submission ids of actions that completed ok.
	acked []int64
}

func readHistory() (*actionFacts, error) {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("could not read the oracle input: %v", err)
	}
	in, err := schema.UnmarshalOracleInput(raw)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(in.HistoryPath)
	if err != nil {
		return nil, fmt.Errorf("open history: %w", err)
	}
	defer f.Close()
	r := schema.NewHistoryReader(f)
	facts := &actionFacts{}
	for {
		e, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("history is malformed, so it cannot be trusted: %w", err)
		}
		if e.RecordKind() != schema.RecordOperation || e.F != opAction {
			continue
		}
		switch e.Type {
		case schema.HistoryInvoke:
			facts.invokes++
		case schema.HistoryOK:
			facts.ok++
			id, err := strconv.ParseInt(strings.TrimSpace(string(e.Value)), 10, 64)
			if err != nil || id <= 0 {
				return nil, fmt.Errorf("an ok action carries %q, not a submission id", string(e.Value))
			}
			facts.acked = append(facts.acked, id)
		case schema.HistoryFail:
			facts.fail++
		case schema.HistoryInfo:
			facts.info++
		}
	}
	return facts, nil
}

/* ── durable ─────────────────────────────────────────────────── */

type finding struct {
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

func durable(node string) verdict {
	h, err := readHistory()
	if err != nil {
		return inconclusive("%v", err)
	}
	db, err := findContainer(node)
	if err != nil {
		return inconclusive("%v", err)
	}
	var findings []finding
	add := func(kind, format string, args ...interface{}) {
		findings = append(findings, finding{Kind: kind, Detail: fmt.Sprintf(format, args...)})
	}

	subs, err := mysqlRows(db, "SELECT id, status, actionKey, IFNULL(JSON_LENGTH(sideEffectJobIds), 0) FROM action_submissions ORDER BY id", 4)
	if err != nil {
		return inconclusive("action_submissions could not be read: %v", err)
	}
	if len(subs) == 0 {
		return inconclusive("action_submissions is empty, which the seed never leaves it; this is not the gate database")
	}
	status := map[int64]string{}
	applied := 0
	for _, s := range subs {
		id, _ := strconv.ParseInt(s[0], 10, 64)
		status[id] = s[1]
		if s[1] == "applied" {
			applied++
			if s[2] == gateAction && s[3] == "0" {
				add("side_effect_not_queued", "submission %d of %s was applied without its side-effect job", id, gateAction)
			}
		}
	}

	// Acknowledged means applied: the driver saw it committed.
	for _, id := range h.acked {
		switch st, ok := status[id]; {
		case !ok:
			add("acknowledged_lost", "submission %d was acknowledged as applied and no longer exists", id)
		case st != "applied":
			add("acknowledged_lost", "submission %d was acknowledged as applied and is %s", id, st)
		}
	}

	// One audit entry per submission, and none without a submission.
	audits, err := mysqlRows(db, "SELECT entityId, COUNT(*) FROM audit_log WHERE entityType = 'action_submission' GROUP BY entityId", 2)
	if err != nil {
		return inconclusive("audit_log could not be read: %v", err)
	}
	auditCount := map[int64]int{}
	for _, a := range audits {
		id, err1 := strconv.ParseInt(a[0], 10, 64)
		n, err2 := strconv.Atoi(a[1])
		if err1 != nil || err2 != nil {
			add("audit_orphan", "an action_submission audit entry names %q", a[0])
			continue
		}
		auditCount[id] = n
		if _, ok := status[id]; !ok {
			add("audit_orphan", "%d audit entr(ies) name submission %d, which does not exist", n, id)
		}
	}
	for id, st := range status {
		if n := auditCount[id]; n != 1 {
			add("audit_count", "%s submission %d has %d audit entries, not 1", st, id, n)
		}
	}

	// Every edit traces to an applied submission.
	sources, err := mysqlRows(db, "SELECT 'node', sourceSubmissionId, COUNT(*) FROM kg_nodes WHERE sourceSubmissionId IS NOT NULL GROUP BY sourceSubmissionId "+
		"UNION ALL SELECT 'edge', sourceSubmissionId, COUNT(*) FROM kg_edges WHERE sourceSubmissionId IS NOT NULL GROUP BY sourceSubmissionId", 3)
	if err != nil {
		return inconclusive("the graph's sources could not be read: %v", err)
	}
	for _, s := range sources {
		id, _ := strconv.ParseInt(s[1], 10, 64)
		if st := status[id]; st != "applied" {
			add("edit_orphan", "%s %s(s) name submission %d as their source, which is %s", s[2], s[0], id, orNone(st))
		}
	}

	// Each person's latest applied gate note is on the person.
	notes, err := mysqlRows(db, "SELECT s.id, JSON_UNQUOTE(JSON_EXTRACT(s.paramsJson, '$.employee')), JSON_UNQUOTE(JSON_EXTRACT(s.paramsJson, '$.note')), "+
		"IFNULL(n.sourceSubmissionId, 0), IFNULL(JSON_UNQUOTE(JSON_EXTRACT(n.propsJson, '$.gateNote')), '') "+
		"FROM action_submissions s JOIN kg_nodes n ON n.workspaceId = s.workspaceId AND n.iri = JSON_UNQUOTE(JSON_EXTRACT(s.paramsJson, '$.employee')) "+
		"WHERE s.status = 'applied' AND s.actionKey = '"+gateAction+"' AND s.id = (SELECT MAX(s2.id) FROM action_submissions s2 "+
		"WHERE s2.status = 'applied' AND s2.actionKey = '"+gateAction+"' AND s2.workspaceId = s.workspaceId "+
		"AND JSON_EXTRACT(s2.paramsJson, '$.employee') = JSON_EXTRACT(s.paramsJson, '$.employee'))", 5)
	if err != nil {
		return inconclusive("the gate notes could not be read: %v", err)
	}
	for _, n := range notes {
		id, _ := strconv.ParseInt(n[0], 10, 64)
		source, _ := strconv.ParseInt(n[3], 10, 64)
		switch {
		case source == 0:
			// An import rewrote the person after the action: documented, not judged.
		case source != id:
			add("edit_lost", "%s's latest applied note is submission %d, but the person names submission %d as its last change", n[1], id, source)
		case n[4] != n[2]:
			add("edit_lost", "%s holds note %q, not %q from submission %d", n[1], n[4], n[2], id)
		}
	}

	summary := fmt.Sprintf("%d submission(s), %d applied; the driver recorded %d action(s) (ok %d, fail %d, info %d)",
		len(subs), applied, h.invokes, h.ok, h.fail, h.info)
	if len(findings) > 0 {
		w := schema.Witness{Key: "action_submissions", Extra: map[string]json.RawMessage{}}
		w.Extra["findings"] = mustJSON(findings)
		w.Extra["phase"] = mustJSON("ASSERT")
		kinds := map[string]int{}
		for _, f := range findings {
			kinds[f.Kind]++
		}
		return verdict{status: schema.StatusViolated, witness: w, explanation: fmt.Sprintf(
			"what the actions did is not what was recorded: %s. First: %s. %s.", countKinds(kinds), findings[0].Detail, summary)}
	}
	return verdict{status: schema.StatusOK, explanation: fmt.Sprintf(
		"every acknowledged action is applied, every submission has one audit entry, every edit traces to an applied submission, "+
			"and every latest gate note is in place: %s.", summary)}
}

func orNone(s string) string {
	if s == "" {
		return "missing"
	}
	return s
}

func countKinds(kinds map[string]int) string {
	keys := make([]string, 0, len(kinds))
	for k := range kinds {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", k, kinds[k]))
	}
	return strings.Join(parts, ", ")
}

/* ── delivered ───────────────────────────────────────────────── */

const sideEffectsSQL = "SELECT j.id, j.status, j.attempts, LEFT(IFNULL(j.lastError, ''), 200) FROM action_submissions s " +
	"JOIN jobs j ON JSON_CONTAINS(s.sideEffectJobIds, CAST(j.id AS JSON)) WHERE s.status = 'applied' ORDER BY j.id"

func delivered(node string, settle time.Duration) verdict {
	h, err := readHistory()
	if err != nil {
		return inconclusive("%v", err)
	}
	db, err := findContainer(node)
	if err != nil {
		return inconclusive("%v", err)
	}
	deadline := time.Now().Add(settle)
	var rows [][]string
	for {
		rows, err = mysqlRows(db, sideEffectsSQL, 4)
		if err != nil {
			fmt.Fprintf(os.Stderr, "query failed: %v\n", err)
		} else if !anyStatus(rows, "queued", "running") {
			break
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(pollInterval)
	}
	if err != nil {
		return inconclusive("side-effect jobs could not be read within %s: %v", settle, err)
	}
	if len(rows) == 0 {
		if h.invokes == 0 {
			return verdict{status: schema.StatusOK, explanation: "not judged: this world submitted no actions, and no applied submission has a side effect"}
		}
		return inconclusive("the driver submitted %d action(s) (ok %d) but no applied submission has a side-effect job, so delivery cannot be judged", h.invokes, h.ok)
	}
	var undelivered []map[string]string
	byStatus := map[string]int{}
	for _, r := range rows {
		byStatus[r[1]]++
		if r[1] != "succeeded" {
			undelivered = append(undelivered, map[string]string{"job_id": r[0], "status": r[1], "attempts": r[2], "last_error": r[3]})
		}
	}
	summary := fmt.Sprintf("%d side-effect job(s): %s", len(rows), countKinds(byStatus))
	if len(undelivered) > 0 {
		w := schema.Witness{Key: "jobs", Extra: map[string]json.RawMessage{}}
		w.Extra["undelivered"] = mustJSON(undelivered)
		w.Extra["settle_ms"] = mustJSON(settle.Milliseconds())
		w.Extra["phase"] = mustJSON("ASSERT")
		return verdict{status: schema.StatusViolated, witness: w, explanation: fmt.Sprintf(
			"%d side effect(s) of applied actions were not delivered within %s (first: job %s %s after %s attempt(s) %s). %s.",
			len(undelivered), settle, undelivered[0]["job_id"], undelivered[0]["status"], undelivered[0]["attempts"], undelivered[0]["last_error"], summary)}
	}
	return verdict{status: schema.StatusOK, explanation: "every side effect of an applied action was delivered: " + summary + "."}
}

func anyStatus(rows [][]string, statuses ...string) bool {
	for _, r := range rows {
		for _, s := range statuses {
			if r[1] == s {
				return true
			}
		}
	}
	return false
}

func mustJSON(v interface{}) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return b
}

/* ── Docker and MySQL ────────────────────────────────────────── */

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

func mysqlRows(container, query string, cols int) ([][]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	// The SQL travels as a positional argument, so no shell quoting touches it.
	out, err := docker(ctx, "exec", container, "sh", "-c",
		`MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" `+
			`--batch --skip-column-names --execute="$1"`, "sh", query)
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
