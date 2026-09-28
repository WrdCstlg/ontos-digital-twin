import http, { type IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";

/**
 * One HTTP exchange over node:http, for the host's calls to its engines and
 * the client's calls to the host. Not fetch: undici gives up on a response
 * whose headers take more than 300 s, and the engine sends its headers only
 * once a load or a SHACL run is done. Here the only limit is `timeoutMs`.
 *
 * No keep-alive (agent: false): a pooled socket to an engine that has since
 * stopped fails the next request for no reason of its own, and a connection on
 * a private network costs next to nothing.
 */

export type HttpBody = string | Uint8Array | Readable | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>;

export type HttpRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: HttpBody;
  /** The whole exchange, from connecting to the last byte of the answer. */
  timeoutMs: number;
  signal?: AbortSignal;
  /** The answer is read into memory: refuse one larger than this. */
  maxResponseBytes?: number;
};

export type HttpAnswer = { status: number; headers: IncomingHttpHeaders; text: string };

/** The exchange took longer than its timeout. */
export class HttpTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`No answer within ${timeoutMs} ms`);
    this.name = "HttpTimeoutError";
  }
}

/** The other side could not be reached, or dropped the connection before its answer was complete. */
export class HttpConnectionError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpConnectionError";
  }
}

/** The answer was larger than `maxResponseBytes`. */
export class HttpResponseTooLarge extends Error {
  constructor(limit: number) {
    super(`The answer was larger than ${limit} bytes`);
    this.name = "HttpResponseTooLarge";
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024 * 1024;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

function toReadable(body: Exclude<HttpBody, string | Uint8Array>): Readable {
  if (body instanceof Readable) return body;
  if (typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    return Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  }
  return Readable.from(body as AsyncIterable<Uint8Array | string>);
}

export function httpRequest(opts: HttpRequest): Promise<HttpAnswer> {
  return new Promise<HttpAnswer>((resolve, reject) => {
    const url = new URL(opts.url);
    const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const headers: Record<string, string> = { ...opts.headers };
    const body = opts.body;
    const fixed = typeof body === "string" || body instanceof Uint8Array;
    if (fixed) headers["content-length"] = String(typeof body === "string" ? Buffer.byteLength(body) : body.byteLength);

    let source: Readable | null = null;
    let settled = false;
    let answered = false;

    const finish = (err: Error | null, answer?: HttpAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (err) {
        source?.destroy();
        reject(err);
      } else {
        resolve(answer!);
      }
    };

    const req = http.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: opts.method,
      headers,
      agent: false,
    });

    const timer = setTimeout(() => {
      const err = new HttpTimeoutError(opts.timeoutMs);
      finish(err);
      req.destroy(err);
    }, opts.timeoutMs);

    function onAbort() {
      const err = abortReason(opts.signal!);
      finish(err);
      req.destroy(err);
    }
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    req.on("response", (res) => {
      answered = true;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          const err = new HttpResponseTooLarge(maxBytes);
          finish(err);
          res.destroy(err);
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () =>
        finish(null, { status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }),
      );
      res.on("error", (err: NodeJS.ErrnoException) => finish(new HttpConnectionError(err.message, err.code)));
      res.on("close", () => {
        if (!res.complete) finish(new HttpConnectionError("The connection closed before the answer was complete."));
      });
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      // An answer that came before the whole body was sent (a 413, say) stands:
      // the error is only the rest of the body having nowhere to go.
      if (answered) return;
      finish(new HttpConnectionError(err.message, err.code));
    });

    if (body === undefined) {
      req.end();
    } else if (fixed) {
      req.end(body);
    } else {
      source = toReadable(body);
      source.on("error", (err) => {
        finish(err);
        req.destroy(err);
      });
      source.pipe(req);
    }
  });
}
