/**
 * Every write to the tables a workspace's graph renders from is recorded as a
 * change (services/graphChanges.ts). A write that is not leaves every copy of
 * the graph in a semantic engine out of date, and nothing would say so. This
 * test knows each file that writes those tables, and how many writes each
 * has. A new write fails it until whoever added it has made it record its
 * change and counted it here. The seeds replace the graph instead
 * (recordGraphReplaced) and are not counted.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API = path.resolve(import.meta.dirname, "..");
const GRAPH_TABLES = ["kgNodes", "kgEdges", "ontologyClasses", "ontologyProperties", "ontologyModules"];
const WRITE = new RegExp(`\\.(?:insert|update|delete)\\(\\s*(?:${GRAPH_TABLES.join("|")})\\s*\\)`, "g");

/** Each file that writes the graph's tables, with its number of writes. */
const WRITERS: Record<string, number> = {
  "ontologyRouter.ts": 4,
  "services/actions/service.ts": 7,
  "services/iot/iotIngestion.ts": 1,
  "services/mappingSync.ts": 2,
  "twinRouter.ts": 1,
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sources(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("the graph's writers", () => {
  it("are all known: a new write to the graph's tables fails this until it records its change", () => {
    const found: Record<string, number> = {};
    for (const file of sources(API)) {
      const writes = [...readFileSync(file, "utf8").matchAll(WRITE)].length;
      if (writes) found[path.relative(API, file).replaceAll(path.sep, "/")] = writes;
    }
    expect(found).toEqual(WRITERS);
  });

  it("each record their changes", () => {
    for (const file of Object.keys(WRITERS)) {
      expect(readFileSync(path.join(API, file), "utf8"), file).toContain("recordGraphChange(");
    }
  });

  it("is a test that sees writes: it finds the ones this file names", () => {
    expect([...".update(kgNodes) .insert( kgEdges ) .delete(ontologyModules) .select(kgNodes)".matchAll(WRITE)]).toHaveLength(3);
  });
});
