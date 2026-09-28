/**
 * The web app's shutdown (lib/shutdown.ts): requests in flight finish while
 * the database is still there, new ones are refused, and the pool closes
 * last. Run on a real HTTP server.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { shutDownInOrder } from "../lib/shutdown";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.closeAllConnections();
});

/** A server whose /slow answers after `ms`, and which records when the database would have been needed. */
async function appServer(ms: number) {
  const events: string[] = [];
  const app = new Hono();
  app.get("/slow", async (c) => {
    await sleep(ms);
    events.push("request answered");
    return c.text("done");
  });
  app.get("/fast", (c) => c.text("fast"));
  const server = await new Promise<http.Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as http.Server)) as http.Server;
  });
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, events };
}

const quiet = () => undefined;

describe("the web app's shutdown", () => {
  it("lets a request in flight finish before the database closes, and refuses new ones", async () => {
    const { server, url, events } = await appServer(300);
    const inFlight = fetch(`${url}/slow`).then((r) => r.text());
    await sleep(50);
    const code = shutDownInOrder({
      server,
      graceMs: 5_000,
      stopJobs: async () => void events.push("jobs stopped"),
      stopIot: async () => void events.push("iot stopped"),
      closeDatabase: async () => void events.push("database closed"),
      log: quiet,
    });
    await sleep(20);
    await expect(fetch(`${url}/fast`)).rejects.toThrow();
    expect(await inFlight).toBe("done");
    expect(await code).toBe(0);
    expect(events).toEqual(["request answered", "jobs stopped", "iot stopped", "database closed"]);
  });

  it("is not held open by an idle keep-alive connection", async () => {
    const { server, url } = await appServer(0);
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) =>
      http.get(`${url}/fast`, { agent }, (res) => res.resume().on("end", () => resolve())).on("error", reject),
    );
    const started = Date.now();
    expect(await shutDownInOrder({ server, graceMs: 5_000, closeDatabase: async () => undefined, log: quiet })).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    agent.destroy();
  });

  it("cuts off a request that outruns the grace, says so, and still closes the database", async () => {
    const { server, url } = await appServer(5_000);
    const inFlight = fetch(`${url}/slow`).then(
      (r) => r.status,
      () => "cut off",
    );
    await sleep(50);
    const logged: string[] = [];
    let closed = false;
    const started = Date.now();
    const code = await shutDownInOrder({
      server,
      graceMs: 200,
      closeDatabase: async () => void (closed = true),
      log: (m) => logged.push(m),
    });
    expect(code).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await inFlight).toBe("cut off");
    expect(closed).toBe(true);
    expect(logged).toContain("[process] Requests still running after 200 ms were cut off.");
  });

  it("goes on to close the database when stopping the jobs or the IoT connections fails", async () => {
    const order: string[] = [];
    const code = await shutDownInOrder({
      graceMs: 100,
      stopJobs: async () => {
        order.push("jobs");
        throw new Error("the worker would not stop");
      },
      stopIot: async () => {
        order.push("iot");
        throw new Error("a broker did not answer");
      },
      closeDatabase: async () => void order.push("database"),
      log: (m) => order.push(m),
    });
    expect(code).toBe(0);
    expect(order).toEqual([
      "jobs",
      "[process] Error stopping the embedded job worker: the worker would not stop",
      "iot",
      "[process] Error stopping the IoT connections: a broker did not answer",
      "database",
      "[process] Drained and closed MySQL connection pool.",
    ]);
  });
});
