/**
 * The migration history only grows, in order. Drizzle applies, to a database
 * already migrated, only the migrations dated after the last one it applied:
 * a new migration dated earlier (one a branch generated first but merged
 * second) is skipped there, and a migration edited after it was applied is
 * never run again. Fresh and upgraded databases would then differ, and no
 * test on a fresh database (mysql/migrations.mysql.test.ts) could tell.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const folder = path.resolve(import.meta.dirname, "../../db/migrations");
const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};
/** A migration's content, line endings aside (a Windows checkout may hold CRLF). */
const hashOf = (tag: string) =>
  createHash("sha256")
    .update(readFileSync(path.join(folder, `${tag}.sql`), "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");

/**
 * Every released migration's content. A new migration adds its line here, in
 * the change that adds the migration; no line ever changes.
 */
const RELEASED: Record<string, string> = {
  "0000_initial_schema": "767809c04252847a735bcdf965dee65a0ba17398c3d4c36ea48937ab7a8ca8c3",
  "0001_mute_millenium_guard": "a822eb227c06ebdfb4f198be211026baebd255c7d2c30649619c319f45377e4e",
  "0002_slim_the_fallen": "a222c5ede69e264c6a00ad1326243dfd79a0bc4abe9713e23436d2e851926b71",
  "0003_ontology_fk_cascades": "bcbf21ff0775a65bd2125532b29deb3f60e880e607332ef1fa77c3241482fbf1",
  "0004_job_queue": "4255032b55799a07cb46e8dc8bdb1a295781fa8a55fcdaff40e6d81696cdac37",
  "0005_action_types": "fce338d641cca7286e0583f29e90bd2e03fd4bb876bfcf502c69a2911bab6c7b",
  "0006_api_tokens": "53b3496b0460eb3146d0131a821fe28f0de83f2ec6d07efc7261c6e94e5a5a36",
  "0007_mapping_shacl_mode": "006b2779562df0a739b32df3dede345a1800b47aa2442e1a81e6367f8e59da7a",
  "0008_audit_chain_lock": "f1aa0659b4c9296e301246a68847c2e009af9698190b2c9ca42093ce411c5116",
};

describe("the migration history", () => {
  it("is in order: each migration is dated after the one before it", () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx, e.tag).toBe(i);
      if (i > 0) expect(e.when, `${e.tag} is dated before ${journal.entries[i - 1].tag}: an upgraded database would skip it`).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });

  it("only grows: no released migration is edited", () => {
    for (const { tag } of journal.entries) {
      expect(hashOf(tag), `${tag}: a database that applied it never runs it again, so change the schema in a new migration (a new one adds its hash to RELEASED)`).toBe(RELEASED[tag]);
    }
  });

  it("lists every migration file, and only those", () => {
    const files = readdirSync(folder)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    expect(files).toEqual(journal.entries.map((e) => e.tag).sort());
    expect(Object.keys(RELEASED).sort()).toEqual(files);
  });
});
