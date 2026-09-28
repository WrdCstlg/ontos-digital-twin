/**
 * What the engine host and its client share: the states an engine can be in,
 * the shapes of the host's answers, and the limits both sides enforce. Types
 * and constants only, so the client pulls in nothing of the host.
 */

/**
 * - `cold`: no engine runs; the next request starts one.
 * - `starting`: an engine is opening its store.
 * - `ready` / `busy`: an engine runs, idle or with requests in flight.
 * - `failed`: the last start failed or the engine exited; the next request
 *   after `retryAt` starts it again.
 * - `locked`: another process holds the store's RocksDB LOCK. Requests are
 *   refused, and the host never resets or deletes the store.
 * - `corrupt`: the store failed to open three times in a row. Only a reset
 *   clears it.
 */
export type EngineState = "cold" | "starting" | "ready" | "busy" | "failed" | "locked" | "corrupt";

export type WorkspaceEngineStatus = {
  workspace: number;
  state: EngineState;
  /** The engine process, while one runs. */
  pid: number | null;
  /** The store's incarnation: a new one on every reset. Null until the store was first opened. */
  incarnation: string | null;
  /** When the current, or last, engine became ready (ISO time). */
  lastStart: string | null;
  /** While busy: since when, and how many requests are in flight. */
  busySince: string | null;
  inFlight: number;
  /** Failed starts and exits in a row, and the earliest next start after one. */
  failures: number;
  retryAt: string | null;
  lastError: string | null;
  /** The store's size as last seen: when it opened, plus what was loaded since. */
  triples: number | null;
};

export type HostErrorCode =
  | "unauthorized"
  | "bad_request"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type"
  | "incarnation_mismatch"
  | "corrupt"
  | "engine_refused"
  | "engine_error"
  | "engine_unavailable"
  | "locked"
  | "at_capacity"
  | "scratch_busy"
  | "shutting_down"
  | "engine_timeout"
  | "internal";

/** Every answer that is not a success. */
export type HostErrorBody = {
  error: { code: HostErrorCode; message: string };
  /** With incarnation_mismatch: the store's current incarnation (null: the store was never opened). */
  incarnation?: string | null;
  /** With locked, corrupt and engine_unavailable: the engine's state. */
  state?: EngineState;
};

/** Writes (update, load) must carry the incarnation of the store they were meant for. */
export const INCARNATION_HEADER = "x-ontos-incarnation";

/** How long, in ms, the engine had been busy with other requests when this one was sent to it. */
export const ENGINE_BUSY_HEADER = "x-engine-busy-ms";

/**
 * The engine reads JSON bodies up to 2 MiB (axum's default) and refuses or cuts
 * off anything larger, so the host refuses larger queries and updates first.
 */
export const ENGINE_JSON_BODY_LIMIT = 2 * 1024 * 1024;

export type LoadFormat = "turtle" | "n-triples" | "trig";

export const LOAD_MEDIA_TYPES: Record<LoadFormat, string> = {
  turtle: "text/turtle",
  "n-triples": "application/n-triples",
  trig: "application/trig",
};

export type ReasoningProfile = "rdfs" | "owl-rl" | "owl-rl-ext" | "owl-dl";

export const REASONING_PROFILES: readonly ReasoningProfile[] = ["rdfs", "owl-rl", "owl-rl-ext", "owl-dl"];

/** A SELECT answer: every value is a term in N-Triples form, e.g. `<urn:a>` or `"1"^^<…#integer>`. */
export type SelectAnswer = { variables: string[]; results: Record<string, string>[] };
export type AskAnswer = { result: boolean };
export type GraphAnswer = { triples: { subject: string; predicate: string; object: string }[] };
/** What `/query` answers: the engine's own JSON, unchanged. */
export type QueryAnswer = SelectAnswer | AskAnswer | GraphAnswer;

export type UpdateAnswer = { affected: number; incarnation: string };

export type LoadAnswer = { triplesLoaded: number; bytes: number; incarnation: string };

/**
 * The engine's SHACL report, unchanged. `scope` is `all_graphs`: SHACL sees
 * every graph in the store. `conforms` is null when no shape's target selected
 * anything: conformance is undetermined, and `warning` and `unmatched_shapes`
 * say so (v1.3.0).
 */
export type ShaclReport = {
  conforms: boolean | null;
  focus_nodes?: number;
  violation_count?: number;
  violations?: Array<{
    constraint?: string;
    focus_node?: string;
    path?: string;
    severity?: "Violation" | "Warning" | "Info";
    message?: string;
    value?: string;
  }>;
  scope?: string;
  warning?: string;
  unmatched_shapes?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type ShaclAnswer = { report: ShaclReport };

/** The engine's reasoning result for a dry run: counts and samples; nothing was written. */
export type ReasonResult = {
  profile_used?: string;
  initial_triples?: number;
  final_triples?: number;
  inferred_count?: number;
  iterations?: number;
  sample_inferences?: string[];
  dry_run?: boolean;
  [key: string]: unknown;
};

export type ReasonAnswer = { result: ReasonResult };

export type ResetAnswer = { incarnation: string };

export type ScratchValidateAnswer = { triplesLoaded: number; report: ShaclReport };
