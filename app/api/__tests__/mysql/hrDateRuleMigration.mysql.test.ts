/**
 * Migration 0012 rewrites the HR date rule in databases seeded before it was
 * fixed. The seed only inserts, so a database seeded earlier keeps the old rule,
 * a `sparql` key holding no query, which the compiler now refuses
 * (docs/DECISIONS.md, D-032). The test database already ran every migration, so
 * the rows here are made as the old seed made them and 0012 is run on them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { SEED_SHACL } from "../../../db/seedShacl";
import { emptyDatabase } from "./database";

const MIGRATION = path.resolve(import.meta.dirname, "../../../db/migrations/0012_hr_date_rule.sql");

/** The rule as the seed stored it before 0012. */
const OLD_RULE = {
  shape: "hr:EmploymentContractShape",
  constraints: [
    { path: "hr:hireDate", minCount: 1, datatype: "xsd:date", severity: "Violation" },
    { path: "hr:endDate", sparql: "endDate >= startDate", severity: "Violation" },
  ],
};

let conn: mysql.Connection;
beforeAll(async () => {
  conn = await mysql.createConnection(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await conn?.end();
});
beforeEach(async () => {
  await emptyDatabase();
});

/** A workspace with an hr module holding these classes and rules; the classes' ids, by IRI. */
async function workspace(slug: string, classes: [iri: string, rule: unknown][]): Promise<Map<string, number>> {
  const [ws] = await conn.query<mysql.ResultSetHeader>("insert into workspaces (name, slug) values (?, ?)", [slug, slug]);
  const [mod] = await conn.query<mysql.ResultSetHeader>(
    "insert into ontology_modules (workspaceId, `key`, name, prefix, color, version) values (?, 'hr', 'HR', 'hr', '#000', '1.0')",
    [ws.insertId],
  );
  const ids = new Map<string, number>();
  for (const [iri, rule] of classes) {
    const [cls] = await conn.query<mysql.ResultSetHeader>("insert into ontology_classes (moduleId, iri, label, shaclJson) values (?, ?, ?, ?)", [
      mod.insertId,
      iri,
      iri,
      rule === null ? null : JSON.stringify(rule),
    ]);
    ids.set(iri, cls.insertId);
  }
  return ids;
}

async function runMigration(): Promise<void> {
  for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) await conn.query(statement);
  }
}

async function rules(): Promise<Record<number, unknown>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("select id, shaclJson from ontology_classes order by id");
  return Object.fromEntries(rows.map((r) => [r.id as number, r.shaclJson]));
}

describe("migration 0012", () => {
  it("rewrites the old HR date rule in every workspace, as the seed now writes it", async () => {
    const a = await workspace("a", [["hr:EmploymentContract", OLD_RULE]]);
    const b = await workspace("b", [["hr:EmploymentContract", OLD_RULE]]);
    await runMigration();
    const after = await rules();
    expect(after[a.get("hr:EmploymentContract")!]).toEqual(SEED_SHACL["hr:EmploymentContract"]);
    expect(after[b.get("hr:EmploymentContract")!]).toEqual(SEED_SHACL["hr:EmploymentContract"]);
  });

  it("leaves every other rule as it is", async () => {
    await workspace("a", [
      ["hr:Person", SEED_SHACL["hr:Person"]],
      ["hr:Skill", null],
    ]);
    // A contract rule that is not the old one, whatever it holds, is not the migration's to change.
    await workspace("b", [["hr:EmploymentContract", { shape: "hr:EmploymentContractShape", constraints: [{ path: "hr:hireDate", minCount: 1 }] }]]);
    const before = await rules();
    await runMigration();
    expect(await rules()).toEqual(before);
  });

  it("changes nothing when run again", async () => {
    await workspace("a", [["hr:EmploymentContract", OLD_RULE]]);
    await runMigration();
    const once = await rules();
    await runMigration();
    expect(await rules()).toEqual(once);
  });
});
