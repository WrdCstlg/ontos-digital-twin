import { EngineRequestError } from "./engineErrors";
import { HttpConnectionError, HttpResponseTooLarge, HttpTimeoutError, httpRequest, type HttpBody } from "./engineHost/engineHttp";
import {
  ENGINE_BUSY_HEADER,
  ENGINE_JSON_BODY_LIMIT,
  INCARNATION_HEADER,
  LOAD_MEDIA_TYPES,
  type EngineState,
  type HostErrorBody,
  type LoadAnswer,
  type LoadFormat,
  type QueryAnswer,
  type ReasonResult,
  type ReasoningProfile,
  type ResetAnswer,
  type ScratchValidateAnswer,
  type ShaclReport,
  type UpdateAnswer,
  type WorkspaceEngineStatus,
} from "./engineHost/types";

/**
 * A typed client for the engine host (api/engineHost.ts): one call per route.
 * Nothing in the app uses it yet; moving reads and writes over is a later
 * change.
 *
 * Failures split as semanticEngine.ts splits them:
 * - EngineHostRefusal, an EngineRequestError: the host, or the engine through
 *   it, answered that it will not do this (4xx): a bad request, an engine
 *   refusal (422), a stale incarnation (409), a corrupt store (409). Asking
 *   again unchanged will not help.
 * - EngineHostUnavailable: whatever may pass on a later try: a 5xx (a locked
 *   store, a busy or failed engine), 408, 429, a timeout, the host not
 *   reachable. `retryAfterMs` says when to, if the host said.
 *
 * Every call has a bounded timeout, a little longer than the host's own for
 * the route so the host's 504 comes first, and accepts an AbortSignal. A
 * caller's abort rejects with the signal's reason.
 */

export class EngineHostRefusal extends EngineRequestError {
  readonly status: number;
  readonly code: string;
  /** With incarnation_mismatch: the store's current incarnation. */
  readonly incarnation?: string | null;
  readonly state?: EngineState;
  constructor(status: number, code: string, message: string, incarnation?: string | null, state?: EngineState) {
    super(message);
    this.name = "EngineHostRefusal";
    this.status = status;
    this.code = code;
    this.incarnation = incarnation;
    this.state = state;
  }
}

export class EngineHostUnavailable extends Error {
  /** Null when no answer came: a timeout, or the host not reachable. */
  readonly status: number | null;
  readonly code: string;
  readonly retryAfterMs: number | null;
  readonly state?: EngineState;
  constructor(message: string, status: number | null, code: string, retryAfterMs: number | null = null, state?: EngineState) {
    super(message);
    this.name = "EngineHostUnavailable";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.state = state;
  }
}

export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };

/** Writes name the incarnation of the store they were prepared for. */
export type WriteOptions = CallOptions & { incarnation: string };

export type ClientTimeouts = {
  health: number;
  status: number;
  query: number;
  update: number;
  load: number;
  shacl: number;
  reason: number;
  reset: number;
  remove: number;
  scratch: number;
};

const MINUTE = 60_000;

export const DEFAULT_CLIENT_TIMEOUTS: ClientTimeouts = {
  health: 2_000,
  status: 5_000,
  query: 35_000,
  update: 65_000,
  load: 11 * MINUTE,
  shacl: 5.5 * MINUTE,
  reason: 5.5 * MINUTE,
  reset: 2 * MINUTE,
  remove: MINUTE,
  scratch: 2.5 * MINUTE,
};

export type EngineHostClientOptions = {
  baseUrl: string;
  token?: string | null;
  timeouts?: Partial<ClientTimeouts>;
};

type Busy = { engineBusyMs: number };

type Exchange = {
  method: string;
  path: string;
  route: keyof ClientTimeouts;
  opts?: CallOptions;
  body?: HttpBody;
  headers?: Record<string, string>;
};

function checkWorkspace(ws: number): void {
  if (!Number.isSafeInteger(ws) || ws <= 0) {
    throw new EngineHostRefusal(400, "bad_request", `A workspace id is a positive whole number, not ${ws}.`);
  }
}

function jsonBody(value: unknown, what: string): string {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > ENGINE_JSON_BODY_LIMIT) {
    throw new EngineHostRefusal(413, "payload_too_large", `${what} is at most ${ENGINE_JSON_BODY_LIMIT} bytes.`);
  }
  return text;
}

export class EngineHostClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly timeouts: ClientTimeouts;

  constructor(opts: EngineHostClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token ?? null;
    this.timeouts = { ...DEFAULT_CLIENT_TIMEOUTS, ...opts.timeouts };
  }

  /** ENGINE_HOST_URL (default http://127.0.0.1:8086) and ENGINE_HOST_TOKEN. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): EngineHostClient {
    return new EngineHostClient({
      baseUrl: env.ENGINE_HOST_URL?.trim() || "http://127.0.0.1:8086",
      token: env.ENGINE_HOST_TOKEN?.trim() || null,
    });
  }

  /** The host's own liveness; never waits for an engine. */
  async health(opts?: CallOptions): Promise<{ status: string }> {
    return (await this.exchange<{ status: string }>({ method: "GET", path: "/health", route: "health", opts })).data;
  }

  /** Answers at once, whatever the engine is doing. */
  async status(ws: number, opts?: CallOptions): Promise<WorkspaceEngineStatus> {
    checkWorkspace(ws);
    return (await this.exchange<WorkspaceEngineStatus>({ method: "GET", path: `/v1/workspaces/${ws}/status`, route: "status", opts })).data;
  }

  /** A SPARQL query form (SELECT, ASK, CONSTRUCT, DESCRIBE); the engine's answer as it gives it. */
  async query(ws: number, sparql: string, opts?: CallOptions): Promise<{ answer: QueryAnswer } & Busy> {
    checkWorkspace(ws);
    const { data, busyMs } = await this.exchange<QueryAnswer>({
      method: "POST",
      path: `/v1/workspaces/${ws}/query`,
      route: "query",
      opts,
      body: jsonBody({ query: sparql }, "A query"),
      headers: { "content-type": "application/json" },
    });
    return { answer: data, engineBusyMs: busyMs };
  }

  /** A SPARQL UPDATE of at most 2 MiB, applied only if the store is still at `incarnation`. */
  async update(ws: number, sparqlUpdate: string, opts: WriteOptions): Promise<UpdateAnswer & Busy> {
    checkWorkspace(ws);
    const { data, busyMs } = await this.exchange<UpdateAnswer>({
      method: "POST",
      path: `/v1/workspaces/${ws}/update`,
      route: "update",
      opts,
      body: jsonBody({ query: sparqlUpdate }, "An update"),
      headers: { "content-type": "application/json", [INCARNATION_HEADER]: opts.incarnation },
    });
    return { ...data, engineBusyMs: busyMs };
  }

  /**
   * Loads RDF of any size (up to the host's cap), streamed: a string, bytes,
   * or a stream of them. Applied only if the store is still at `incarnation`.
   */
  async load(ws: number, body: HttpBody, opts: WriteOptions & { format: LoadFormat }): Promise<LoadAnswer & Busy> {
    checkWorkspace(ws);
    const { data, busyMs } = await this.exchange<LoadAnswer>({
      method: "POST",
      path: `/v1/workspaces/${ws}/load`,
      route: "load",
      opts,
      body,
      headers: { "content-type": LOAD_MEDIA_TYPES[opts.format], [INCARNATION_HEADER]: opts.incarnation },
    });
    return { ...data, engineBusyMs: busyMs };
  }

  /** SHACL over the whole store (every graph in it). */
  async shacl(ws: number, shapesTurtle: string, opts?: CallOptions): Promise<{ report: ShaclReport } & Busy> {
    checkWorkspace(ws);
    const { data, busyMs } = await this.exchange<{ report: ShaclReport }>({
      method: "POST",
      path: `/v1/workspaces/${ws}/shacl`,
      route: "shacl",
      opts,
      body: shapesTurtle,
      headers: { "content-type": "text/turtle" },
    });
    return { report: data.report, engineBusyMs: busyMs };
  }

  /** A reasoning dry run: counts and samples of what would be inferred; the store is not changed. */
  async reason(ws: number, opts?: CallOptions & { profile?: ReasoningProfile }): Promise<{ result: ReasonResult } & Busy> {
    checkWorkspace(ws);
    const { data, busyMs } = await this.exchange<{ result: ReasonResult }>({
      method: "POST",
      path: `/v1/workspaces/${ws}/reason`,
      route: "reason",
      opts,
      body: JSON.stringify({ profile: opts?.profile ?? "owl-rl" }),
      headers: { "content-type": "application/json" },
    });
    return { result: data.result, engineBusyMs: busyMs };
  }

  /** Empties the store and gives it a new incarnation, which later writes must name. */
  async reset(ws: number, opts?: CallOptions): Promise<ResetAnswer> {
    checkWorkspace(ws);
    return (await this.exchange<ResetAnswer>({ method: "POST", path: `/v1/workspaces/${ws}/reset`, route: "reset", opts })).data;
  }

  /** Stops the workspace's engine and deletes its store. */
  async deleteWorkspace(ws: number, opts?: CallOptions): Promise<void> {
    checkWorkspace(ws);
    await this.exchange({ method: "DELETE", path: `/v1/workspaces/${ws}`, route: "remove", opts });
  }

  /** Validates `data` against `shapes` on a scratch engine that holds nothing else. */
  async scratchValidate(input: { data: string; shapes: string }, opts?: CallOptions): Promise<ScratchValidateAnswer> {
    const { data } = await this.exchange<ScratchValidateAnswer>({
      method: "POST",
      path: "/v1/scratch/validate",
      route: "scratch",
      opts,
      body: JSON.stringify({ data: input.data, shapes: input.shapes }),
      headers: { "content-type": "application/json" },
    });
    return data;
  }

  private async exchange<T>(ex: Exchange): Promise<{ data: T; busyMs: number }> {
    const timeoutMs = ex.opts?.timeoutMs ?? this.timeouts[ex.route];
    const headers: Record<string, string> = { accept: "application/json", ...ex.headers };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await httpRequest({
        method: ex.method,
        url: `${this.baseUrl}${ex.path}`,
        headers,
        body: ex.body,
        timeoutMs,
        signal: ex.opts?.signal,
      });
    } catch (err) {
      if (ex.opts?.signal?.aborted) throw ex.opts.signal.reason;
      if (err instanceof HttpTimeoutError) {
        throw new EngineHostUnavailable(`The engine host did not answer within ${timeoutMs} ms`, null, "timeout");
      }
      if (err instanceof HttpConnectionError) {
        throw new EngineHostUnavailable(`The engine host could not be reached: ${err.message}`, null, "unreachable");
      }
      if (err instanceof HttpResponseTooLarge) throw new EngineHostUnavailable(err.message, null, "too_large");
      throw err;
    }
    if (res.status < 200 || res.status >= 300) throw this.failure(res.status, res.text, res.headers["retry-after"]);
    let data: T;
    try {
      data = JSON.parse(res.text) as T;
    } catch {
      throw new EngineHostUnavailable(`The engine host answered HTTP ${res.status} with something that is not JSON`, res.status, "bad_answer");
    }
    const busyMs = Number(res.headers[ENGINE_BUSY_HEADER] ?? 0);
    return { data, busyMs: Number.isFinite(busyMs) ? busyMs : 0 };
  }

  private failure(status: number, text: string, retryAfter: string | string[] | undefined): Error {
    let body: Partial<HostErrorBody> = {};
    try {
      body = JSON.parse(text) as HostErrorBody;
    } catch {
      // not the host's JSON (a proxy's page, say): the status says enough
    }
    const code = body.error?.code ?? `http_${status}`;
    const message = body.error?.message ?? `The engine host answered HTTP ${status}`;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return new EngineHostRefusal(status, code, message, body.incarnation, body.state);
    }
    const seconds = Number(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter);
    return new EngineHostUnavailable(message, status, code, Number.isFinite(seconds) ? seconds * 1000 : null, body.state);
  }
}
