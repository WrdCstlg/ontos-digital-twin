/**
 * A CopyEngine (services/graphCopy.ts) on an engine reached directly, over its
 * REST API: what the tests of the catch-up run against, with an engine of
 * their own (privateEngine.ts). Refusals the engine answers with HTTP 200 are
 * thrown, as the real binding throws them.
 */
import type { CopyEngine } from "../services/graphCopy";
import { LOAD_REQUEST_BYTES, engineRefusal, type SparqlResult } from "../services/semanticEngine";
import { packTurtle, type TurtleSubject } from "../services/rdfBridge";

export function directCopyEngine(url: string): CopyEngine & { triples(): Promise<string[]> } {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const answer = (await res.json()) as unknown;
    const refused = Array.isArray(answer) ? (answer[0] as { result?: unknown })?.result && engineRefusal((answer[0] as { result: unknown }).result) : engineRefusal(answer);
    if (refused) throw new Error(`${path}: ${refused}`);
    return answer;
  };
  const query = async (sparql: string) => (await post("/api/query", { query: sparql })) as SparqlResult;
  const count = async () => Number(/\d+/.exec((await query("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }")).results[0]?.n ?? "")?.[0]);
  return {
    query,
    async update(sparql) {
      await post("/api/update", { query: sparql });
    },
    async reset() {
      await post("/api/batch", [{ command: "clear", args: [] }]);
    },
    async load(prefixMap: Map<string, string>, subjects: AsyncIterable<TurtleSubject>) {
      // In batches of subjects, each cut into documents a request carries.
      let batch: TurtleSubject[] = [];
      const flush = async () => {
        for (const doc of packTurtle(prefixMap, batch, LOAD_REQUEST_BYTES)) await post("/api/load-turtle", { turtle: doc });
        batch = [];
      };
      for await (const s of subjects) {
        batch.push(s);
        if (batch.length >= 5_000) await flush();
      }
      await flush();
      return count();
    },
    /** Every triple of the default graph, as the engine writes them, sorted: a copy's content. */
    async triples() {
      const { results } = await query("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
      return results.map((t) => `${t.s} ${t.p} ${t.o}`).sort();
    },
  };
}
