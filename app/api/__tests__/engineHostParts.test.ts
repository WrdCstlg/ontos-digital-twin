/**
 * The engine host's smaller parts: its settings, how it reads the engine's
 * answers and exit messages, how it starts an engine, which workspace ids it
 * accepts, and the directory it keeps stores in.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOST_REASON, rawErrorMessage, readBatchAnswer, readEngineAnswer } from "../services/engineHost/answers";
import { ConfigError, MIN_TOKEN_LENGTH, findEngineBinary, readHostConfig } from "../services/engineHost/config";
import { DataRoot, DataRootError, ROOT_MARKER } from "../services/engineHost/dataRoot";
import { HostError } from "../services/engineHost/errors";
import { classifyEarlyExit, engineArgs, engineEnv, type LaunchSpec } from "../services/engineHost/process";
import { loadFormat, workspaceId } from "../services/engineHost/server";
import { removeDir, tempDir } from "./engineHostFakes";

const dirs: string[] = [];
function scratchDir(): string {
  const d = tempDir("ontos-parts-");
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await removeDir(d);
});

const TOKEN = "k".repeat(MIN_TOKEN_LENGTH);

function binaryIn(dir: string): string {
  const bin = path.join(dir, process.platform === "win32" ? "open-ontologies.exe" : "open-ontologies");
  fs.writeFileSync(bin, "");
  return bin;
}

describe("settings", () => {
  it("refuses to start without a token, unless ENGINE_HOST_DEV=true says this is development", () => {
    const bin = binaryIn(scratchDir());
    expect(() => readHostConfig({ ENGINE_HOST_BIN: bin })).toThrow(ConfigError);
    expect(() => readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_TOKEN: "short" })).toThrow(/at least 32/);
    expect(readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_TOKEN: TOKEN }).token).toBe(TOKEN);

    const dev = readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_DEV: "true" });
    expect(dev).toMatchObject({ token: null, dev: true, bind: "127.0.0.1" });
    // Without a token, only loopback.
    expect(() => readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_DEV: "true", ENGINE_HOST_BIND: "0.0.0.0" })).toThrow(
      /loopback/,
    );
    expect(() => readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_DEV: "yes" })).toThrow(/true or false/);
  });

  it("has safe defaults, and refuses a setting it cannot read", () => {
    const dir = scratchDir();
    const bin = binaryIn(dir);
    const config = readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_TOKEN: TOKEN }, dir);
    expect(config).toMatchObject({
      dataDir: path.join(dir, ".ontos-engines"),
      bind: "127.0.0.1",
      port: 8086,
      binPath: path.resolve(bin),
      maxEngines: 16,
      idleMs: 600_000,
      scratchEngines: 2,
      loadMaxBytes: 2 * 1024 ** 3,
      timeouts: { query: 30_000, update: 60_000, load: 600_000, shacl: 300_000, reason: 300_000, scratch: 120_000 },
    });

    const tuned = readHostConfig(
      { ENGINE_HOST_BIN: bin, ENGINE_HOST_TOKEN: TOKEN, ENGINE_HOST_MAX_ENGINES: "4", ENGINE_HOST_QUERY_TIMEOUT_MS: "1500" },
      dir,
    );
    expect(tuned.maxEngines).toBe(4);
    expect(tuned.timeouts.query).toBe(1500);

    for (const [name, value] of [
      ["ENGINE_HOST_MAX_ENGINES", "0"],
      ["ENGINE_HOST_MAX_ENGINES", "sixteen"],
      ["ENGINE_HOST_PORT", "70000"],
      ["ENGINE_HOST_IDLE_MS", "-5"],
      ["ENGINE_HOST_LOAD_MAX_BYTES", "1.5"],
    ]) {
      expect(() => readHostConfig({ ENGINE_HOST_BIN: bin, ENGINE_HOST_TOKEN: TOKEN, [name]: value }, dir), name).toThrow(
        ConfigError,
      );
    }
  });

  it("finds the engine: ENGINE_HOST_BIN, then OPEN_ONTOLOGIES_BIN, then bin/ beside the app", () => {
    const dir = scratchDir();
    const a = binaryIn(fs.mkdtempSync(path.join(dir, "a-")));
    const b = binaryIn(fs.mkdtempSync(path.join(dir, "b-")));
    expect(findEngineBinary({ ENGINE_HOST_BIN: a, OPEN_ONTOLOGIES_BIN: b }, dir)).toBe(path.resolve(a));
    expect(findEngineBinary({ OPEN_ONTOLOGIES_BIN: b }, dir)).toBe(path.resolve(b));
    expect(() => findEngineBinary({ ENGINE_HOST_BIN: path.join(dir, "missing") }, dir)).toThrow(/names no file/);

    fs.mkdirSync(path.join(dir, "bin"));
    const local = binaryIn(path.join(dir, "bin"));
    expect(findEngineBinary({}, dir)).toBe(local);
  });
});

describe("the engine's answers", () => {
  it("reads success, a refusal, and the null a refusal becomes when its message holds a quote", () => {
    expect(readEngineAnswer('{"ok":true,"affected":2}')).toEqual({ ok: true, body: { ok: true, affected: 2 } });
    expect(readEngineAnswer('{"error":"The graph <urn:g> does not exist"}')).toEqual({
      ok: false,
      message: "The graph <urn:g> does not exist",
    });
    expect(readEngineAnswer("null")).toEqual({ ok: false, message: LOST_REASON });
  });

  it("treats a body that is not a JSON object as the engine's fault, not a refusal", () => {
    for (const text of ["", "<html>", "[1,2]", "42"]) {
      const err = (() => {
        try {
          readEngineAnswer(text);
        } catch (e) {
          return e;
        }
      })();
      expect(err, text).toBeInstanceOf(HostError);
      expect(err, text).toMatchObject({ status: 502, code: "engine_error" });
    }
  });

  it("reads a batch result, its error, a parse failure, and the raw text of an error with a quote", () => {
    const shacl = { conforms: false, violation_count: 1 };
    expect(readBatchAnswer(JSON.stringify([{ seq: 0, command: "shacl", result: shacl }]))).toEqual({ ok: true, body: shacl });
    expect(readBatchAnswer('[{"seq":0,"command":"shacl","result":{"error":"No such file (os error 2)"}}]')).toEqual({
      ok: false,
      message: "No such file (os error 2)",
    });
    expect(readBatchAnswer('[{"seq":0,"command":"parse","error":"expected value"}]')).toEqual({
      ok: false,
      message: "expected value",
    });
    const raw = JSON.stringify([{ seq: 0, command: "shacl", result: { raw: '{"error":"Turtle error: unexpected "x""}' } }]);
    expect(readBatchAnswer(raw)).toEqual({ ok: false, message: 'Turtle error: unexpected "x"' });
    expect(rawErrorMessage("not the usual shape")).toBe("not the usual shape");
  });
});

describe("starting an engine", () => {
  const spec: LaunchSpec = { label: "ws-3", dataDir: path.join(os.tmpdir(), "root", "ws-3"), port: 45123, mode: "persistent", token: "t0k" };

  it("passes --data-dir first, persistent storage, loopback, and never --idle-ttl-secs", () => {
    const args = engineArgs(spec);
    expect(args.slice(0, 3)).toEqual(["--data-dir", spec.dataDir, "serve-http"]);
    expect(args).toEqual(expect.arrayContaining(["--storage-mode", "persistent", "--host", "127.0.0.1", "--port", "45123"]));
    expect(args[args.indexOf("--config") + 1]).toBe(path.join(spec.dataDir, "config.toml"));
    expect(args.join(" ")).not.toMatch(/idle-ttl|unload-timeout|--token/);
    expect(engineArgs({ ...spec, mode: "memory" })).toEqual(expect.arrayContaining(["--storage-mode", "memory"]));
  });

  it("sets HOME to the data directory and hands the engine its own token, and none of the host's secrets", () => {
    const env = engineEnv(spec, {
      PATH: "/usr/bin",
      ENGINE_HOST_TOKEN: "host-secret",
      OPEN_ONTOLOGIES_STORAGE_MODE: "memory",
      OPEN_ONTOLOGIES_TOKEN: "someone-elses",
      DATABASE_URL: "mysql://root:pw@db/ontos",
      APP_SECRET: "app-secret",
    });
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: spec.dataDir, USERPROFILE: spec.dataDir, OPEN_ONTOLOGIES_TOKEN: "t0k" });
    expect(env).not.toHaveProperty("ENGINE_HOST_TOKEN");
    expect(env).not.toHaveProperty("OPEN_ONTOLOGIES_STORAGE_MODE");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("APP_SECRET");
  });

  it("tells a held LOCK and a taken port from any other failed open, on Linux and Windows", () => {
    expect(
      classifyEarlyExit(
        "Error: failed to open persistent Oxigraph store at /d/triplestore: IO error: While lock file: /d/triplestore/LOCK: Resource temporarily unavailable",
      ),
    ).toBe("locked");
    expect(
      classifyEarlyExit(
        "Error: failed to open persistent Oxigraph store at C:\\d\\triplestore: IO error: Failed to create lock file: C:\\d\\triplestore/LOCK: The process cannot access the file because it is being used by another process.",
      ),
    ).toBe("locked");
    expect(classifyEarlyExit("Error: Address already in use (os error 98)")).toBe("port_in_use");
    expect(
      classifyEarlyExit(
        "Error: Only one usage of each socket address (protocol/network address/port) is normally permitted. (os error 10048)",
      ),
    ).toBe("port_in_use");
    expect(classifyEarlyExit("Error: failed to open persistent Oxigraph store at /d: Corruption: bad block")).toBe("store");
    // A LOCK file that cannot be created for want of permission is not another process's lock.
    expect(classifyEarlyExit("IO error: Failed to create lock file: /d/triplestore/LOCK: Permission denied")).toBe("store");
    expect(classifyEarlyExit("")).toBe("store");
  });
});

describe("requests", () => {
  it("accepts a positive whole number as a workspace id, and nothing else", () => {
    expect(workspaceId("1")).toBe(1);
    expect(workspaceId("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    for (const raw of ["0", "-1", "01", "1.5", "1e3", "abc", "", " 1", "9007199254740992", "../1", "..", "%2e%2e", "1/..", undefined]) {
      expect(() => workspaceId(raw), String(raw)).toThrow(HostError);
    }
  });

  it("loads Turtle, N-Triples and TriG, by content type, and nothing else", () => {
    expect(loadFormat("text/turtle")).toBe("turtle");
    expect(loadFormat("text/turtle; charset=utf-8")).toBe("turtle");
    expect(loadFormat("application/n-triples")).toBe("n-triples");
    expect(loadFormat("application/trig")).toBe("trig");
    for (const type of [undefined, "", "application/json", "application/rdf+xml", "text/plain"]) {
      expect(() => loadFormat(type), String(type)).toThrow(expect.objectContaining({ status: 415 }));
    }
  });
});

describe("the data root", () => {
  it("makes a missing directory its own, and opens it again", async () => {
    const dir = path.join(scratchDir(), "engines");
    const root = await DataRoot.open(dir);
    expect(fs.existsSync(path.join(dir, ROOT_MARKER))).toBe(true);
    expect(root.storeDir(12)).toBe(path.join(dir, "ws-12"));
    await DataRoot.open(dir);
  });

  it("refuses a directory that holds files the host did not make", async () => {
    const dir = scratchDir();
    fs.writeFileSync(path.join(dir, "ibdata1"), "someone else's");
    await expect(DataRoot.open(dir)).rejects.toBeInstanceOf(DataRootError);
    expect(fs.readdirSync(dir)).toEqual(["ibdata1"]);
    await expect(DataRoot.open(os.homedir())).rejects.toBeInstanceOf(DataRootError);
    await expect(DataRoot.open(path.parse(os.tmpdir()).root)).rejects.toBeInstanceOf(DataRootError);
  });

  it("names no path but ws-<positive id>", async () => {
    const root = await DataRoot.open(path.join(scratchDir(), "engines"));
    for (const ws of [0, -1, 1.5, Number.NaN, 2 ** 60]) expect(() => root.storeDir(ws)).toThrow();
  });

  it("writes host.json whole, and treats a torn one as missing", async () => {
    const root = await DataRoot.open(path.join(scratchDir(), "engines"));
    expect(await root.readMeta(1)).toBeNull();
    const meta = { incarnation: "abc", createdAt: new Date(0).toISOString(), triples: 3, corrupt: null };
    await root.writeMeta(1, meta);
    expect(await root.readMeta(1)).toEqual(meta);
    expect(fs.readdirSync(root.storeDir(1))).toEqual(["host.json"]);

    fs.writeFileSync(path.join(root.storeDir(1), "host.json"), '{"incarnation": "ab');
    expect(await root.readMeta(1)).toBeNull();
  });

  it("deletes a store by moving it aside first, and clears what a dead host left behind", async () => {
    const dir = path.join(scratchDir(), "engines");
    const root = await DataRoot.open(dir);
    fs.mkdirSync(path.join(root.storeDir(4), "triplestore"), { recursive: true });
    fs.writeFileSync(path.join(root.storeDir(4), "triplestore", "000001.sst"), "x");
    await root.removeStore(4);
    await root.removeStore(4); // already gone: fine
    expect(fs.existsSync(root.storeDir(4))).toBe(false);
    expect(fs.readdirSync(root.trashDir)).toEqual([]);

    fs.mkdirSync(path.join(root.trashDir, "ws-9-1-abc"), { recursive: true });
    const stale = path.join(root.tempDir, "old.ttl");
    const fresh = path.join(root.tempDir, "new.ttl");
    fs.writeFileSync(stale, "x");
    fs.writeFileSync(fresh, "x");
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(stale, dayAgo, dayAgo);
    await DataRoot.open(dir);
    expect(fs.readdirSync(root.trashDir)).toEqual([]);
    expect(fs.readdirSync(root.tempDir)).toEqual(["new.ttl"]);
  });
});
