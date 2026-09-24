// Command ontosload is the PRO-THESIS driver for Ontos.
//
// The harness starts it at DRIVE. It signs in once, runs the operation plan
// against Ontos's HTTP API, and writes every operation to the history as an
// invoke followed by exactly one completion:
//
//	ok    the operation certainly took effect
//	fail  it certainly did not
//	info  it may or may not have
//
// `fail` is kept for outcomes that prove nothing happened: the connection could
// not be opened, so the request was never sent, or the server rejected it with
// a 4xx before doing any work. A timeout, a dropped connection or a 5xx
// part-way through an import is `info`. An oracle may require an ok operation
// to be visible in the final state; it must never require that of an info.
//
// Operations (the plan's mix keys, and the history's `f`):
//
//	sync  mapping.runSync on a CSV mapping, i.e. one full import.
//	      key "mapping/<id>"; the ok value is the sync job's id.
//
// At QUIESCE the harness writes {"cmd":"stop"} on stdin and closes it. The
// driver then stops issuing operations, lets the ones in flight finish (each is
// bounded by the request timeout, which is below the harness's drain
// deadline), flushes the history and exits.
//
// Every parameter is required. A missing one, a plan it cannot execute
// verbatim, or a failed sign-in exits non-zero instead of improvising.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/WrdCstlg/pro-thesis/pkg/schema"
)

const (
	planSchema = "prothesis.driver_plan/v1"
	opSync     = "sync"

	// requestTimeout bounds every operation. It stays below the harness's 10 s
	// drain deadline, so an operation in flight at QUIESCE always completes (as
	// ok, fail or info) before the driver is killed.
	requestTimeout = 8 * time.Second

	// backoff follows any operation that did not complete ok. While the app is
	// down every request is refused at once; without a pause two clients would
	// spend the whole `ops` ceiling in a tight loop against a closed port.
	backoff = 200 * time.Millisecond
)

// Exit codes. Any non-zero exit leaves the harness with whatever history was
// flushed, which its oracles then judge (or refuse to).
const (
	exitOK      = 0
	exitRuntime = 1 // the history could not be written
	exitRefuse  = 2 // bad parameters, a plan it cannot execute, or no session
)

func main() { os.Exit(run()) }

type params struct {
	history, plan, profile, app, email, password string
	seed                                         uint64
}

func run() int {
	p, err := parseParams(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "ontosload:", err)
		return exitRefuse
	}
	// The harness discards stdout and stderr, so the log goes next to the history.
	log := newLogger(filepath.Join(filepath.Dir(p.history), "driver.log"))
	defer log.close()
	log.printf("start: profile=%s seed=%d app=%s email=%s", p.profile, p.seed, p.app, p.email)

	pl, err := loadPlan(p)
	if err != nil {
		log.printf("refusing: %v", err)
		return exitRefuse
	}

	hist, err := openHistory(p.history)
	if err != nil {
		log.printf("refusing: %v", err)
		return exitRefuse
	}
	defer hist.close()

	stop := newStopSignal()
	if os.Getenv("PROTHESIS_STDIN_CONTROL") == "1" {
		go stop.watchStdin(os.Stdin, log)
	}
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() { <-sigs; log.printf("signal received: stopping"); stop.fire() }()

	c := newClient(p.app, clientsFor(pl))
	ctx := context.Background()
	if err := c.signIn(ctx, p.email, p.password, log); err != nil {
		log.printf("refusing: sign-in failed: %v", err)
		return exitRefuse
	}
	mappings, err := c.runnableCSVMappings(ctx)
	if err != nil {
		log.printf("refusing: cannot list mappings: %v", err)
		return exitRefuse
	}
	log.printf("runnable CSV mappings: %v", mappings)

	var counts outcomeCounts
	if len(pl.Operations) > 0 {
		err = runOperations(ctx, pl, mappings, c, hist, stop, &counts, log)
	} else {
		err = runProfile(ctx, pl, p.seed, mappings, c, hist, stop, &counts, log)
	}
	if err != nil {
		log.printf("refusing: %v", err)
		return exitRefuse
	}
	if werr := hist.err(); werr != nil {
		log.printf("history write failed: %v", werr)
		return exitRuntime
	}
	log.printf("done: %s", counts.String())
	return exitOK
}

func parseParams(args []string) (params, error) {
	fs := flag.NewFlagSet("ontosload", flag.ContinueOnError)
	var p params
	var seed string
	fs.StringVar(&p.history, "history", "", "history file to write (harness {history_path})")
	fs.StringVar(&p.plan, "plan", "", "operation plan to execute (harness {plan_path})")
	fs.StringVar(&seed, "seed", "", "world seed (harness {seed})")
	fs.StringVar(&p.profile, "profile", "", "driver profile (harness {profile})")
	fs.StringVar(&p.app, "app", "", "Ontos base URL, e.g. http://127.0.0.1:13000")
	fs.StringVar(&p.email, "email", "", "account to sign in as")
	fs.StringVar(&p.password, "password", "", "that account's password")
	if err := fs.Parse(args); err != nil {
		return p, err
	}
	missing := []string{}
	for name, v := range map[string]string{
		"history": p.history, "plan": p.plan, "seed": seed, "profile": p.profile,
		"app": p.app, "email": p.email, "password": p.password,
	} {
		if v == "" {
			missing = append(missing, "--"+name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return p, fmt.Errorf("missing required parameter(s) %s", strings.Join(missing, ", "))
	}
	s, err := strconv.ParseUint(seed, 10, 64)
	if err != nil {
		return p, fmt.Errorf("--seed %q is not an unsigned integer", seed)
	}
	p.seed = s
	p.app = strings.TrimRight(p.app, "/")
	if envPlan := os.Getenv("PROTHESIS_PLAN_PATH"); envPlan != "" && !samePath(envPlan, p.plan) {
		return p, fmt.Errorf("--plan %q disagrees with PROTHESIS_PLAN_PATH %q", p.plan, envPlan)
	}
	return p, nil
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

type planMix struct {
	Op        string `json:"op"`
	WeightPPM int64  `json:"weight_ppm"`
}

type planOp struct {
	OpID     int64           `json:"op_id"`
	Process  int64           `json:"process"`
	F        string          `json:"f"`
	Key      *string         `json:"key,omitempty"`
	Value    json.RawMessage `json:"value,omitempty"`
	ReadMode string          `json:"read_mode,omitempty"`
	Target   string          `json:"target,omitempty"`
	AtMS     int64           `json:"at_ms"`
	Pinned   bool            `json:"pinned,omitempty"`
}

type plan struct {
	Schema      string    `json:"schema"`
	Profile     string    `json:"profile"`
	Seed        uint64    `json:"seed"`
	HistoryPath string    `json:"history_path"`
	Clients     int       `json:"clients"`
	Ops         int       `json:"ops"`
	Mix         []planMix `json:"mix"`
	Operations  []planOp  `json:"operations,omitempty"`
	Targets     []string  `json:"targets,omitempty"`
	Origin      string    `json:"origin,omitempty"`
	OriginNS    int64     `json:"origin_ns,omitempty"`
}

// loadPlan reads the plan strictly: an unknown member could carry meaning this
// driver would silently ignore, and executing a plan only partly understood is
// improvising.
func loadPlan(p params) (*plan, error) {
	raw, err := os.ReadFile(p.plan)
	if err != nil {
		return nil, fmt.Errorf("read plan: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var pl plan
	if err := dec.Decode(&pl); err != nil {
		return nil, fmt.Errorf("decode plan: %w", err)
	}
	switch {
	case pl.Schema != planSchema:
		return nil, fmt.Errorf("plan schema is %q, want %q", pl.Schema, planSchema)
	case pl.Profile != p.profile:
		return nil, fmt.Errorf("plan is for profile %q, --profile is %q", pl.Profile, p.profile)
	case pl.Seed != p.seed:
		return nil, fmt.Errorf("plan seed %d disagrees with --seed %d", pl.Seed, p.seed)
	case pl.HistoryPath != "" && !samePath(pl.HistoryPath, p.history):
		return nil, fmt.Errorf("plan history_path %q disagrees with --history %q", pl.HistoryPath, p.history)
	case pl.Clients < 1 || pl.Ops < 1:
		return nil, fmt.Errorf("plan needs clients >= 1 and ops >= 1 (got %d, %d)", pl.Clients, pl.Ops)
	}
	positive := 0
	for _, m := range pl.Mix {
		if !supportedOp(m.Op) {
			return nil, fmt.Errorf("plan mix names operation %q, which this driver does not implement", m.Op)
		}
		if m.WeightPPM > 0 {
			positive++
		}
	}
	if len(pl.Operations) == 0 && positive == 0 {
		return nil, errors.New("plan mix has no operation with a positive weight")
	}
	for i, op := range pl.Operations {
		if !supportedOp(op.F) {
			return nil, fmt.Errorf("plan operation %d (op_id %d) is %q, which this driver does not implement", i, op.OpID, op.F)
		}
		if op.OpID <= 0 || (i > 0 && op.OpID <= pl.Operations[i-1].OpID) {
			return nil, fmt.Errorf("plan operation %d has op_id %d; op_ids must be positive and strictly ascending", i, op.OpID)
		}
		if _, err := mappingFromKey(op.Key); err != nil {
			return nil, fmt.Errorf("plan operation op_id %d: %w", op.OpID, err)
		}
	}
	return &pl, nil
}

func supportedOp(op string) bool { return op == opSync }

func mappingFromKey(key *string) (int64, error) {
	if key == nil || !strings.HasPrefix(*key, "mapping/") {
		return 0, errors.New(`a sync operation needs key "mapping/<id>"`)
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(*key, "mapping/"), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("key %q does not name a mapping id", *key)
	}
	return id, nil
}

func clientsFor(pl *plan) int {
	if len(pl.Operations) == 0 {
		return pl.Clients
	}
	seen := map[int64]bool{}
	for _, op := range pl.Operations {
		seen[op.Process] = true
	}
	return len(seen)
}

func samePath(a, b string) bool {
	ca, cb := filepath.Clean(a), filepath.Clean(b)
	if aa, err := filepath.Abs(ca); err == nil {
		ca = aa
	}
	if bb, err := filepath.Abs(cb); err == nil {
		cb = bb
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(ca, cb)
	}
	return ca == cb
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

// runProfile generates operations from the mix. `ops` is the total across all
// clients; the stop signal usually ends DRIVE long before it is used up.
func runProfile(ctx context.Context, pl *plan, seed uint64, mappings []int64, c *client,
	h *history, stop *stopSignal, counts *outcomeCounts, log *logger) error {
	if len(mappings) == 0 {
		return errors.New("the plan needs sync, but Ontos has no runnable CSV mapping")
	}
	var remaining atomic.Int64
	remaining.Store(int64(pl.Ops))
	var wg sync.WaitGroup
	for proc := 0; proc < pl.Clients; proc++ {
		wg.Add(1)
		go func(proc int64) {
			defer wg.Done()
			rng := rand.New(rand.NewSource(int64(seed) + proc))
			for !stop.fired() && h.err() == nil && remaining.Add(-1) >= 0 {
				op := pickOp(pl.Mix, rng)
				mapping := mappings[rng.Intn(len(mappings))]
				if doOp(ctx, c, h, counts, proc, 0, op, mapping) != schema.HistoryOK {
					select {
					case <-time.After(backoff):
					case <-stop.done:
					}
				}
			}
		}(int64(proc))
	}
	wg.Wait()
	log.printf("profile run finished (stopped=%v)", stop.fired())
	return nil
}

// runOperations executes a replay plan verbatim: one sequential worker per
// recorded process, each taking that process's operations in plan order with
// their recorded op_id, f and key, no random choice, and each issued no
// earlier than its at_ms offset from the start of execution.
func runOperations(ctx context.Context, pl *plan, mappings []int64, c *client,
	h *history, stop *stopSignal, counts *outcomeCounts, log *logger) error {
	runnable := map[int64]bool{}
	for _, m := range mappings {
		runnable[m] = true
	}
	byProc := map[int64][]planOp{}
	for _, op := range pl.Operations {
		id, _ := mappingFromKey(op.Key)
		if !runnable[id] {
			return fmt.Errorf("plan op_id %d targets mapping %d, which is not a runnable CSV mapping here", op.OpID, id)
		}
		byProc[op.Process] = append(byProc[op.Process], op)
	}
	start := time.Now()
	var wg sync.WaitGroup
	for proc, ops := range byProc {
		wg.Add(1)
		go func(proc int64, ops []planOp) {
			defer wg.Done()
			for _, op := range ops {
				if stop.fired() || h.err() != nil {
					return
				}
				if wait := time.Until(start.Add(time.Duration(op.AtMS) * time.Millisecond)); wait > 0 {
					select {
					case <-time.After(wait):
					case <-stop.done:
						return
					}
				}
				id, _ := mappingFromKey(op.Key)
				doOp(ctx, c, h, counts, proc, op.OpID, op.F, id)
			}
		}(proc, ops)
	}
	wg.Wait()
	log.printf("replay finished (stopped=%v)", stop.fired())
	return nil
}

func pickOp(mix []planMix, rng *rand.Rand) string {
	var total int64
	for _, m := range mix {
		if m.WeightPPM > 0 {
			total += m.WeightPPM
		}
	}
	r := rng.Int63n(total)
	for _, m := range mix {
		if m.WeightPPM <= 0 {
			continue
		}
		if r < m.WeightPPM {
			return m.Op
		}
		r -= m.WeightPPM
	}
	return mix[len(mix)-1].Op
}

// doOp records the invoke, performs the operation, records its completion and
// returns the outcome. A zero opID asks the history for the next id.
func doOp(ctx context.Context, c *client, h *history, counts *outcomeCounts,
	proc, opID int64, f string, mapping int64) schema.HistoryType {
	key := "mapping/" + strconv.FormatInt(mapping, 10)
	id, invokedAt := h.invoke(proc, opID, f, key)
	res := c.sync(ctx, mapping)
	h.complete(proc, id, invokedAt, f, key, res)
	counts.add(res.kind)
	return res.kind
}

// ---------------------------------------------------------------------------
// Ontos client
// ---------------------------------------------------------------------------

// dialError marks a failure to open the connection: the request was never
// sent, so it cannot have taken effect.
type dialError struct{ err error }

func (e *dialError) Error() string { return "connect: " + e.err.Error() }
func (e *dialError) Unwrap() error { return e.err }

type client struct {
	base   string
	http   *http.Client
	cookie string
}

func newClient(base string, conns int) *client {
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			conn, err := dialer.DialContext(ctx, network, addr)
			if err != nil {
				return nil, &dialError{err}
			}
			return conn, nil
		},
		MaxIdleConnsPerHost: conns + 1,
		IdleConnTimeout:     30 * time.Second,
	}
	return &client{base: base, http: &http.Client{Transport: transport}}
}

type result struct {
	kind  schema.HistoryType
	value json.RawMessage
	err   string
}

// sync runs mapping.runSync once and classifies the outcome.
func (c *client) sync(ctx context.Context, mappingID int64) result {
	body := fmt.Sprintf(`{"json":{"mappingId":%d}}`, mappingID)
	resp, err := c.post(ctx, "/api/trpc/mapping.runSync", body)
	if err != nil {
		var de *dialError
		if errors.As(err, &de) {
			return result{kind: schema.HistoryFail, err: "not sent: " + de.Error()}
		}
		return result{kind: schema.HistoryInfo, err: "indeterminate: " + err.Error()}
	}
	defer resp.Body.Close()
	payload, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	switch {
	case resp.StatusCode == http.StatusOK:
		// The server sends 200 only after the import has committed, so the
		// operation took effect even if the body cannot be read in full.
		var ok struct {
			Result struct {
				Data struct {
					JSON struct {
						Job struct {
							ID int64 `json:"id"`
						} `json:"job"`
					} `json:"json"`
				} `json:"data"`
			} `json:"result"`
		}
		if readErr == nil && json.Unmarshal(payload, &ok) == nil && ok.Result.Data.JSON.Job.ID > 0 {
			return result{kind: schema.HistoryOK, value: json.RawMessage(strconv.FormatInt(ok.Result.Data.JSON.Job.ID, 10))}
		}
		return result{kind: schema.HistoryOK}
	case rejectedBeforeWork(resp.StatusCode):
		return result{kind: schema.HistoryFail, err: fmt.Sprintf("rejected: HTTP %d %s", resp.StatusCode, trpcMessage(payload))}
	default:
		// A 5xx can come part-way through an import that has already written
		// rows, so the outcome is unknown.
		return result{kind: schema.HistoryInfo, err: fmt.Sprintf("indeterminate: HTTP %d %s", resp.StatusCode, trpcMessage(payload))}
	}
}

// rejectedBeforeWork lists the statuses runSync returns only before it has
// touched anything: input validation, authentication, authorisation, an
// unknown mapping, a non-CSV connector, and rate limiting.
func rejectedBeforeWork(status int) bool {
	switch status {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden,
		http.StatusNotFound, http.StatusTooManyRequests:
		return true
	}
	return false
}

func trpcMessage(payload []byte) string {
	var e struct {
		Error struct {
			JSON struct {
				Message string `json:"message"`
			} `json:"json"`
		} `json:"error"`
	}
	if json.Unmarshal(payload, &e) == nil && e.Error.JSON.Message != "" {
		return e.Error.JSON.Message
	}
	return ""
}

func (c *client) post(ctx context.Context, path, body string) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, strings.NewReader(body))
	if err != nil {
		cancel()
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cookie != "" {
		req.Header.Set("Cookie", c.cookie)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}
	resp.Body = cancelOnClose{resp.Body, cancel}
	return resp, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b cancelOnClose) Close() error { err := b.ReadCloser.Close(); b.cancel(); return err }

// signIn opens one session shared by every client, so the login rate limit
// (10 attempts per account per 15 minutes) is never in play.
func (c *client) signIn(ctx context.Context, email, password string, log *logger) error {
	creds, err := json.Marshal(map[string]map[string]string{"json": {"email": email, "password": password}})
	if err != nil {
		return err
	}
	var last error
	for attempt := 1; attempt <= 3; attempt++ {
		resp, err := c.post(ctx, "/api/trpc/auth.login", string(creds))
		if err != nil {
			last = err
		} else {
			payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				last = fmt.Errorf("HTTP %d %s", resp.StatusCode, trpcMessage(payload))
			} else {
				for _, ck := range resp.Cookies() {
					if ck.Name == "ontos_session" || ck.Name == "__Host-ontos_session" {
						c.cookie = ck.Name + "=" + ck.Value
						return nil
					}
				}
				last = errors.New("login succeeded but set no session cookie")
			}
		}
		log.printf("sign-in attempt %d failed: %v", attempt, last)
		time.Sleep(time.Second)
	}
	return last
}

// runnableCSVMappings lists the mappings mapping.runSync can execute: those
// whose connector is CSV with inline data. Sorted by id, so a seeded choice
// among them is reproducible.
func (c *client) runnableCSVMappings(ctx context.Context) ([]int64, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/api/trpc/mapping.listMappings", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cookie", c.cookie)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d %s", resp.StatusCode, trpcMessage(payload))
	}
	var list struct {
		Result struct {
			Data struct {
				JSON []struct {
					ID        int64 `json:"id"`
					Connector *struct {
						Type       string                 `json:"type"`
						ConfigJSON map[string]interface{} `json:"configJson"`
					} `json:"connector"`
				} `json:"json"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(payload, &list); err != nil {
		return nil, fmt.Errorf("decode mapping list: %w", err)
	}
	var ids []int64
	for _, m := range list.Result.Data.JSON {
		if m.Connector == nil || m.Connector.Type != "csv" {
			continue
		}
		if text, ok := m.Connector.ConfigJSON["csvText"].(string); ok && text != "" {
			ids = append(ids, m.ID)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids, nil
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

type history struct {
	mu     sync.Mutex
	f      *os.File
	w      *schema.HistoryWriter
	nextID int64
	werr   error
}

func openHistory(path string) (*history, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open history: %w", err)
	}
	return &history{f: f, w: schema.NewHistoryWriter(f)}, nil
}

// invoke writes an invoke record and returns its op_id and timestamp. Records
// are flushed one at a time, so a driver killed mid-run leaves whole lines.
func (h *history) invoke(proc, opID int64, f, key string) (int64, int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if opID == 0 {
		h.nextID++
		opID = h.nextID
	} else if opID > h.nextID {
		h.nextID = opID
	}
	t := time.Now().UnixNano()
	h.write(&schema.HistoryEntry{TNS: t, Process: &proc, Type: schema.HistoryInvoke, F: f, Key: &key, OpID: &opID})
	return opID, t
}

func (h *history) complete(proc, opID, invokedAt int64, f, key string, r result) {
	h.mu.Lock()
	defer h.mu.Unlock()
	// A completion never precedes its invoke, even if the wall clock steps back.
	t := time.Now().UnixNano()
	if t <= invokedAt {
		t = invokedAt + 1
	}
	h.write(&schema.HistoryEntry{TNS: t, Process: &proc, Type: r.kind, F: f, Key: &key,
		Value: r.value, OpID: &opID, Error: r.err})
}

func (h *history) write(e *schema.HistoryEntry) {
	if h.werr != nil {
		return
	}
	if err := h.w.Write(e); err != nil {
		h.werr = err
		return
	}
	h.werr = h.w.Flush()
}

func (h *history) err() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.werr
}

func (h *history) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.werr == nil {
		h.werr = h.w.Flush()
	}
	if err := h.f.Close(); err != nil && h.werr == nil {
		h.werr = err
	}
}

// ---------------------------------------------------------------------------
// stop signal, counts, log
// ---------------------------------------------------------------------------

type stopSignal struct {
	once sync.Once
	done chan struct{}
}

func newStopSignal() *stopSignal { return &stopSignal{done: make(chan struct{})} }

func (s *stopSignal) fire() { s.once.Do(func() { close(s.done) }) }

func (s *stopSignal) fired() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// watchStdin implements the drain: {"cmd":"stop"} or EOF both mean stop.
func (s *stopSignal) watchStdin(r io.Reader, log *logger) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		var msg struct {
			Cmd string `json:"cmd"`
		}
		if json.Unmarshal(sc.Bytes(), &msg) == nil && msg.Cmd == "stop" {
			log.printf("drain: stop received")
			s.fire()
			return
		}
	}
	log.printf("drain: stdin closed")
	s.fire()
}

type outcomeCounts struct{ ok, fail, info atomic.Int64 }

func (c *outcomeCounts) add(k schema.HistoryType) {
	switch k {
	case schema.HistoryOK:
		c.ok.Add(1)
	case schema.HistoryFail:
		c.fail.Add(1)
	default:
		c.info.Add(1)
	}
}

func (c *outcomeCounts) String() string {
	return fmt.Sprintf("ok=%d fail=%d info=%d", c.ok.Load(), c.fail.Load(), c.info.Load())
}

type logger struct {
	mu sync.Mutex
	f  *os.File
}

func newLogger(path string) *logger {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return &logger{}
	}
	return &logger{f: f}
}

func (l *logger) printf(format string, args ...interface{}) {
	l.mu.Lock()
	defer l.mu.Unlock()
	line := time.Now().UTC().Format(time.RFC3339Nano) + " " + fmt.Sprintf(format, args...) + "\n"
	if l.f != nil {
		_, _ = l.f.WriteString(line)
	} else {
		_, _ = os.Stderr.WriteString(line)
	}
}

func (l *logger) close() {
	if l.f != nil {
		_ = l.f.Close()
	}
}
