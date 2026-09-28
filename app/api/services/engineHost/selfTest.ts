import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBatchAnswer, readEngineAnswer } from "./answers";
import { httpRequest } from "./engineHttp";
import { message } from "./errors";
import { McpSessionClient } from "./mcp";
import { ChildProcessLauncher } from "./process";
import { ScratchPool, type ScratchLease } from "./scratch";

/**
 * `node dist/engineHost.js --self-test`: proves the engine binary runs where
 * the host runs. It starts one scratch engine, loads three triples, runs a
 * SHACL check that must find the one violation planted in them, and a
 * reasoning dry run that must infer one triple and leave the three as they
 * were. Everything it makes goes in a temporary directory, removed after.
 */

const DEADLINE_MS = 60_000;

const DATA = `@prefix ex: <https://ontos.dev/self-test/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Dog rdfs:subClassOf ex:Animal .
ex:rex a ex:Dog .
ex:rex ex:name "Rex" .
`;

// Rex has no chip id: one violation.
const SHAPES = `@prefix ex: <https://ontos.dev/self-test/> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:DogShape a sh:NodeShape ; sh:targetClass ex:Dog ;
  sh:property [ sh:path ex:chipId ; sh:minCount 1 ] .
`;

async function post(engine: ScratchLease, route: string, body: unknown): Promise<string> {
  const res = await httpRequest({
    method: "POST",
    url: `http://127.0.0.1:${engine.port}${route}`,
    headers: { "content-type": "application/json", authorization: `Bearer ${engine.token}` },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  if (res.status !== 200) throw new Error(`${route} answered HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  return res.text;
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

async function run(engine: ScratchLease, dir: string, log: (line: string) => void): Promise<void> {
  const dataFile = path.join(dir, "data.ttl");
  const shapesFile = path.join(dir, "shapes.ttl");
  await fs.writeFile(dataFile, DATA);
  await fs.writeFile(shapesFile, SHAPES);

  const loaded = readEngineAnswer(await post(engine, "/api/load", { path: dataFile }));
  check(loaded.ok, `the load was refused: ${loaded.ok ? "" : loaded.message}`);
  const triples = loaded.ok ? Number(loaded.body.triples_loaded) : NaN;
  check(triples === 3, `expected 3 triples loaded, got ${triples}`);
  log("loaded 3 triples from a file");

  const shacl = readBatchAnswer(await post(engine, "/api/batch", [{ command: "shacl", args: [shapesFile] }]));
  check(shacl.ok, `SHACL was refused: ${shacl.ok ? "" : shacl.message}`);
  const report = shacl.ok ? shacl.body : {};
  const violations = Array.isArray(report.violations) ? report.violations : [];
  check(report.conforms === false && violations.length === 1, `expected SHACL to find 1 violation, got ${JSON.stringify(report).slice(0, 300)}`);
  log("SHACL found the planted violation");

  const mcp = new McpSessionClient({ clientName: "ontos-engine-host-self-test" });
  const reasoned = await mcp.callTool(
    { url: `http://127.0.0.1:${engine.port}/mcp`, token: engine.token },
    "onto_reason",
    { profile: "rdfs", materialize: false },
    AbortSignal.timeout(20_000),
  );
  const result = JSON.parse(reasoned.text) as { dry_run?: boolean; inferred_count?: number; error?: string };
  check(!reasoned.isError && !result.error, `reasoning was refused: ${reasoned.text.slice(0, 200)}`);
  check(result.dry_run === true && (result.inferred_count ?? 0) >= 1, `expected a dry run inferring 1 triple, got ${reasoned.text.slice(0, 300)}`);

  const count = readEngineAnswer(
    await post(engine, "/api/query", { query: "SELECT (COUNT(*) AS ?n) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }" }),
  );
  const n = count.ok ? String((count.body.results as Array<Record<string, string>>)?.[0]?.n ?? "") : "";
  check(/^"?3"?(\^\^.*)?$/.test(n), `expected the store to still hold 3 triples after the dry run, got ${n || "no answer"}`);
  log(`reasoning dry run inferred ${result.inferred_count} triple(s) and left the store as it was`);
}

/** True when every step passed. */
export async function runSelfTest(binPath: string, log: (line: string) => void = (l) => console.log(`[engine-host] self-test: ${l}`)): Promise<boolean> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ontos-engine-self-test-"));
  const pool = new ScratchPool({
    size: 1,
    waitMs: 0,
    startTimeoutMs: 20_000,
    launcher: new ChildProcessLauncher(binPath, () => undefined),
    log,
  });
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    log(`engine binary ${binPath}`);
    await Promise.race([
      pool.use(async (engine) => {
        log(`scratch engine up in ${Date.now() - started} ms`);
        await run(engine, dir, log);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`did not finish within ${DEADLINE_MS} ms`)), DEADLINE_MS);
      }),
    ]);
    log(`passed in ${Date.now() - started} ms`);
    return true;
  } catch (err) {
    log(`FAILED: ${message(err)}`);
    return false;
  } finally {
    clearTimeout(timer);
    await pool.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  }
}
