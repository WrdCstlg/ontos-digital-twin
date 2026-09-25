// Command oracle-session is the `session.honoured` oracle for the Ontos gate.
//
// Invariant: a signed-in client is never told it is signed out. The driver
// signs in once before DRIVE, and its session outlives any world (sessions last
// seven days, and nothing in a world revokes one). So no operation may be
// refused as unauthenticated: a 401 means the server answered "you are not
// signed in" to someone who was, and the web app treats that answer as a
// sign-out.
//
// It reads only the history: ontosload records a refusal as `fail` with the
// error "rejected: HTTP <status> <message>", so a 401 is `HTTP 401` in the
// error of a fail completion.
//
// Fail closed: a history it cannot read, or one in which no operation
// completed, is `inconclusive`.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const oracleName = "session.honoured"

var refusedAsSignedOut = regexp.MustCompile(`\bHTTP 401\b`)

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
		finish(inconclusive("oracle-session takes no arguments, got %q", strings.Join(os.Args[1:], " ")))
	}
	finish(evaluate())
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

type refusal struct {
	OpID  int64  `json:"op_id"`
	F     string `json:"f"`
	TMS   int64  `json:"t_ms"`
	Error string `json:"error"`
}

func evaluate() verdict {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
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

	r := schema.NewHistoryReader(f)
	var driveNS int64
	completed := map[string]int{}
	var refused []refusal
	for {
		e, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return inconclusive("history is malformed, so it cannot be trusted: %v", err)
		}
		if e.RecordKind() == schema.RecordMarker {
			if e.Event == schema.EventPhase && e.Phase == "DRIVE" && driveNS == 0 {
				driveNS = e.TNS
			}
			continue
		}
		if e.RecordKind() != schema.RecordOperation || e.Type == schema.HistoryInvoke {
			continue
		}
		completed[e.F]++
		if e.Type == schema.HistoryFail && refusedAsSignedOut.MatchString(e.Error) {
			rf := refusal{F: e.F, Error: e.Error}
			if e.OpID != nil {
				rf.OpID = *e.OpID
			}
			if driveNS > 0 {
				rf.TMS = (e.TNS - driveNS) / 1_000_000
			}
			refused = append(refused, rf)
		}
	}

	total := 0
	names := make([]string, 0, len(completed))
	for name, n := range completed {
		total += n
		names = append(names, fmt.Sprintf("%s %d", name, n))
	}
	sort.Strings(names)
	if total == 0 {
		return inconclusive("no operation completed, so no answer to a signed-in client can be judged")
	}
	summary := fmt.Sprintf("%d operation(s) completed (%s)", total, strings.Join(names, ", "))
	if len(refused) == 0 {
		return verdict{status: schema.StatusOK, explanation: "no operation of the signed-in driver was refused as signed out: " + summary + "."}
	}
	w := schema.Witness{Key: "session", Extra: map[string]json.RawMessage{}}
	b, _ := json.Marshal(refused)
	w.Extra["refused_as_signed_out"] = b
	w.Extra["phase"] = json.RawMessage(`"DRIVE"`)
	if driveNS > 0 {
		t, _ := json.Marshal(refused[0].TMS)
		w.Extra["first_seen_ms"] = t
	}
	return verdict{status: schema.StatusViolated, witness: w, explanation: fmt.Sprintf(
		"%d operation(s) of a signed-in client were refused as signed out (first at t+%dms: %s). The session was valid throughout, "+
			"so the server answered \"not signed in\" when it could not tell; the web app takes that answer as a sign-out. %s.",
		len(refused), refused[0].TMS, refused[0].Error, summary)}
}
