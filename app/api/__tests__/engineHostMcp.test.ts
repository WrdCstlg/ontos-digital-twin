/**
 * The engine host's MCP client against a fake server that behaves as the
 * engine's rmcp 1.4 does: a session id from initialize, answers as short
 * server-sent event streams, and 404 "Session not found" once it restarted.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  McpConnectionError,
  McpHttpError,
  McpProtocolError,
  McpSessionClient,
  SseParser,
} from "../services/engineHost/mcp";
import { FakeMcp, type FakeMcpOptions } from "./engineHostFakes";

const TOKEN = "engine-token";
const servers: http.Server[] = [];

async function serve(opts: FakeMcpOptions = {}): Promise<{ mcp: FakeMcp; endpoint: { url: string; token: string } }> {
  const mcp = new FakeMcp({ token: TOKEN, ...opts });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => void mcp.handle(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { mcp, endpoint: { url: `http://127.0.0.1:${port}/mcp`, token: TOKEN } };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("SseParser", () => {
  it("dispatches an event at each blank line and skips rmcp's empty priming event", () => {
    const p = new SseParser();
    expect(p.push('data: \nid: 0\nretry: 3000\n\ndata: {"a":1}\nid: 0/0\n\n')).toEqual([{ data: '{"a":1}' }]);
  });

  it("reads lines split across chunks, CRLF and lone CR endings, comments and multi-line data", () => {
    const p = new SseParser();
    const events = [
      ...p.push(": a comment\r"),
      ...p.push("\ndata: first"),
      ...p.push(" half\r\ndata:second line\r\n"),
      ...p.push("\r\ndata: x\rdata: y\r"),
    ];
    expect(events).toEqual([{ data: "first half\nsecond line" }]);
    // A CR that ends a chunk may be half of a CRLF: the blank line is known only with the next byte.
    expect(p.push("\r")).toEqual([]);
    expect(p.push("\n")).toEqual([{ data: "x\ny" }]);
  });

  it("dispatches a last event the stream ended without a blank line after", () => {
    const p = new SseParser();
    expect(p.push("data: last")).toEqual([]);
    expect(p.end()).toEqual([{ data: "last" }]);
  });
});

describe("McpSessionClient", () => {
  it("initializes once, then sends the session id and protocol version with each call", async () => {
    const { mcp, endpoint } = await serve({ tool: (name, args) => ({ text: JSON.stringify({ name, args }) }) });
    const client = new McpSessionClient();

    const first = await client.callTool(endpoint, "onto_reason", { profile: "rdfs", materialize: false });
    const second = await client.callTool(endpoint, "onto_reason", { profile: "owl-rl", materialize: false });

    expect(JSON.parse(first.text)).toEqual({ name: "onto_reason", args: { profile: "rdfs", materialize: false } });
    expect(JSON.parse(second.text).args.profile).toBe("owl-rl");
    expect(first.isError).toBe(false);
    expect(mcp.initializeCount).toBe(1);
    expect(mcp.calls.map((c) => c.session)).toEqual([client.session, client.session]);
    expect(mcp.calls.every((c) => c.protocolVersion === "2025-06-18")).toBe(true);
  });

  it("parses an answer that arrives a few bytes at a time", async () => {
    const { endpoint } = await serve({ chunkBytes: 7, tool: () => ({ text: '{"dry_run":true,"inferred_count":2}' }) });
    const res = await new McpSessionClient().callTool(endpoint, "onto_reason", {});
    expect(JSON.parse(res.text)).toEqual({ dry_run: true, inferred_count: 2 });
  });

  it("accepts a plain JSON answer as well as an event stream", async () => {
    const { endpoint } = await serve({ json: true, tool: () => ({ text: "{}" }) });
    expect((await new McpSessionClient().callTool(endpoint, "onto_reason", {})).text).toBe("{}");
  });

  it("opens a new session once when the engine restarted and forgot its own, then retries", async () => {
    const { mcp, endpoint } = await serve({ tool: () => ({ text: "{}" }) });
    const client = new McpSessionClient();
    await client.callTool(endpoint, "onto_reason", {});
    const before = client.session;

    mcp.restart();
    await client.callTool(endpoint, "onto_reason", {});

    expect(mcp.initializeCount).toBe(2);
    expect(client.reinitializations).toBe(1);
    expect(client.session).not.toBe(before);
    expect(mcp.calls).toHaveLength(2);
  });

  it("opens a new session only once per call: a second 404 is an error", async () => {
    const { mcp, endpoint } = await serve({ tool: () => ({ text: "{}" }) });
    const client = new McpSessionClient();
    await client.callTool(endpoint, "onto_reason", {});
    mcp.opts.forgetOnCall = true;

    const err = await client.callTool(endpoint, "onto_reason", {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpHttpError);
    expect(err).toMatchObject({ status: 404 });
    expect(mcp.initializeCount).toBe(2);
    expect(client.reinitializations).toBe(1);
  });

  it("shares one initialize among calls that start together", async () => {
    const { mcp, endpoint } = await serve({ tool: () => ({ text: "{}" }) });
    const client = new McpSessionClient();
    await Promise.all([1, 2, 3, 4].map(() => client.callTool(endpoint, "onto_reason", {})));
    expect(mcp.initializeCount).toBe(1);
    expect(new Set(mcp.calls.map((c) => c.session)).size).toBe(1);
  });

  it("reports a tool's own error as such, and a JSON-RPC error as a protocol error", async () => {
    const { mcp, endpoint } = await serve({ tool: () => ({ text: "no such profile", isError: true }) });
    const client = new McpSessionClient();
    expect(await client.callTool(endpoint, "onto_reason", {})).toEqual({ text: "no such profile", isError: true });

    mcp.opts.tool = () => ({ rpcError: { code: -32602, message: "tool not found" } });
    const err = await client.callTool(endpoint, "onto_nope", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpProtocolError);
    expect(err).toMatchObject({ rpcCode: -32602, message: expect.stringContaining("tool not found") });
  });

  it("sends the engine's token, and fails plainly without the right one", async () => {
    const { endpoint } = await serve();
    const err = await new McpSessionClient()
      .callTool({ ...endpoint, token: "wrong" }, "onto_reason", {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpHttpError);
    expect(err).toMatchObject({ status: 401 });
  });

  it("fails as a connection error when nothing listens", async () => {
    const { endpoint } = await serve();
    await new Promise((r) => servers.pop()!.close(r));
    const err = await new McpSessionClient().callTool(endpoint, "onto_reason", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpConnectionError);
  });

  it("gives up when its caller does", async () => {
    const { endpoint } = await serve({
      tool: () => new Promise((r) => setTimeout(() => r({ text: "{}" }), 2000)),
    });
    const client = new McpSessionClient();
    const started = Date.now();
    const err = await client.callTool(endpoint, "onto_reason", {}, AbortSignal.timeout(100)).catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
