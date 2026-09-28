/**
 * A small MCP client over streamable HTTP, for an engine's /mcp. The host needs
 * it for one thing the REST API cannot do: `onto_reason` with
 * `materialize: false`, a dry run that leaves the store untouched. The REST
 * API's reason command always writes its inferences into the default graph.
 *
 * The engine's MCP server (rmcp 1.4.0, protocol 2025-06-18) keeps sessions in
 * memory. `initialize` answers with an `mcp-session-id` header, and every
 * answer comes as a short server-sent event stream: an empty priming event,
 * then the JSON-RPC response. After the engine restarts, the old session id
 * answers 404 "Session not found"; the client then initializes again, once,
 * and retries.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

const INIT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export type McpEndpoint = { url: string; token: string };

export type McpToolResult = { text: string; isError: boolean };

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** The engine could not be reached, or dropped the connection. */
export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConnectionError";
  }
}

/** The engine answered with an HTTP status the client does not expect. */
export class McpHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "McpHttpError";
  }
}

/** The answer broke the protocol, or was a JSON-RPC error. */
export class McpProtocolError extends Error {
  constructor(
    message: string,
    readonly rpcCode?: number,
  ) {
    super(message);
    this.name = "McpProtocolError";
  }
}

export type SseEvent = { data: string };

/** Server-sent events, per the HTML spec's parsing rules, fed a chunk at a time. */
export class SseParser {
  private buffer = "";
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    const lineEnd = /\r\n|\n|\r/g;
    let start = 0;
    for (;;) {
      lineEnd.lastIndex = start;
      const m = lineEnd.exec(this.buffer);
      if (!m) break;
      // A CR that ends the buffer may be the first half of a CRLF.
      if (m[0] === "\r" && m.index === this.buffer.length - 1) break;
      this.line(this.buffer.slice(start, m.index), events);
      start = m.index + m[0].length;
    }
    this.buffer = this.buffer.slice(start);
    return events;
  }

  /** The stream ended: an event without its closing blank line still counts. */
  end(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer) this.line(this.buffer, events);
    this.buffer = "";
    this.line("", events);
    return events;
  }

  private line(line: string, events: SseEvent[]): void {
    if (line === "") {
      const data = this.data.join("\n");
      this.data = [];
      if (data !== "") events.push({ data });
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
  }
}

function responseFor(data: string, id: number): JsonRpcMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const m of messages) {
    if (m && typeof m === "object" && (m as JsonRpcMessage).id === id && !("method" in m)) return m as JsonRpcMessage;
  }
  return null;
}

async function readAnswer(res: Response, id: number, maxBytes: number): Promise<JsonRpcMessage> {
  if (!res.body) throw new McpProtocolError("The engine answered without a body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  const parser = new SseParser();
  let json = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new McpProtocolError(`The engine's answer was larger than ${maxBytes} bytes`);
      const text = decoder.decode(value, { stream: true });
      if (!sse) {
        json += text;
        continue;
      }
      for (const event of parser.push(text)) {
        const message = responseFor(event.data, id);
        if (message) return message;
      }
    }
    if (sse) {
      for (const event of parser.end()) {
        const message = responseFor(event.data, id);
        if (message) return message;
      }
      throw new McpProtocolError("The engine's event stream ended without an answer");
    }
    const message = responseFor(json + decoder.decode(), id);
    if (!message) throw new McpProtocolError("The engine's answer was not the JSON-RPC response asked for");
    return message;
  } finally {
    // Done with the stream, answered or not: let the connection go.
    reader.cancel().catch(() => undefined);
  }
}

function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export type McpClientOptions = {
  clientName?: string;
  maxResponseBytes?: number;
  fetch?: typeof fetch;
};

/** One session with one engine. Several calls may share it at once. */
export class McpSessionClient {
  private sessionId: string | null = null;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private opening: Promise<string> | null = null;
  private nextId = 1;
  /** How often a session had to be opened again because the engine forgot it. */
  reinitializations = 0;

  constructor(private readonly opts: McpClientOptions = {}) {}

  get session(): string | null {
    return this.sessionId;
  }

  async callTool(
    endpoint: McpEndpoint,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.openSession(endpoint, signal);
      const id = this.nextId++;
      const res = await this.post(
        endpoint,
        { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
        session,
        signal,
      );
      if (res.status === 404 && attempt === 0) {
        // The engine restarted and forgot the session: open a new one, once.
        await res.body?.cancel().catch(() => undefined);
        this.forget(session);
        this.reinitializations++;
        continue;
      }
      const message = await this.answer(res, id, `tools/call ${name}`);
      if (message.error) {
        throw new McpProtocolError(`${name}: ${message.error.message ?? "JSON-RPC error"}`, message.error.code);
      }
      const result = (message.result ?? {}) as { content?: Array<{ type?: string; text?: unknown }>; isError?: unknown };
      const text = (Array.isArray(result.content) ? result.content : [])
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
      return { text, isError: result.isError === true };
    }
  }

  private forget(session: string): void {
    if (this.sessionId === session) this.sessionId = null;
  }

  private openSession(endpoint: McpEndpoint, signal?: AbortSignal): Promise<string> {
    if (this.sessionId) return Promise.resolve(this.sessionId);
    if (!this.opening) {
      // Shared by every call that finds no session, and bounded on its own, so
      // one caller giving up does not fail the others.
      const opening: Promise<string> = this.initialize(endpoint).finally(() => {
        if (this.opening === opening) this.opening = null;
      });
      // Its failure reaches each waiting call; this only keeps it from counting
      // as unhandled once none waits.
      opening.catch(() => undefined);
      this.opening = opening;
    }
    return raceSignal(this.opening, signal);
  }

  private async initialize(endpoint: McpEndpoint): Promise<string> {
    const signal = AbortSignal.timeout(INIT_TIMEOUT_MS);
    const id = this.nextId++;
    const res = await this.post(
      endpoint,
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: this.opts.clientName ?? "ontos-engine-host", version: "1" },
        },
      },
      null,
      signal,
    );
    const session = res.headers.get("mcp-session-id");
    const message = await this.answer(res, id, "initialize");
    if (message.error) throw new McpProtocolError(`initialize: ${message.error.message ?? "JSON-RPC error"}`, message.error.code);
    if (!session) throw new McpProtocolError("The engine answered initialize without a session id");
    const version = (message.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    if (typeof version === "string" && version) this.protocolVersion = version;

    const note = await this.post(endpoint, { jsonrpc: "2.0", method: "notifications/initialized" }, session, signal);
    await note.body?.cancel().catch(() => undefined);
    if (!note.ok) throw new McpHttpError(note.status, `notifications/initialized: HTTP ${note.status}`);
    this.sessionId = session;
    return session;
  }

  private async answer(res: Response, id: number, what: string): Promise<JsonRpcMessage> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new McpHttpError(res.status, `${what}: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
    }
    return readAnswer(res, id, this.opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  }

  private async post(
    endpoint: McpEndpoint,
    message: Record<string, unknown>,
    session: string | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${endpoint.token}`,
    };
    if (session) {
      headers["mcp-session-id"] = session;
      headers["mcp-protocol-version"] = this.protocolVersion;
    }
    try {
      return await (this.opts.fetch ?? fetch)(endpoint.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      throw new McpConnectionError(err instanceof Error ? `${err.message}${causeOf(err)}` : String(err));
    }
  }
}

function causeOf(err: Error): string {
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error ? `: ${cause.message}` : "";
}
