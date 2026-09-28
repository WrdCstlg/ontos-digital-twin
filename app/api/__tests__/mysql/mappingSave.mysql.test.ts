/**
 * A mapping's save is a conditional update: it writes only while the
 * mapping's SHACL mode is still the one the save read, and reports a conflict
 * when no row matched (mappingRouter.upsertMapping). MySQL counts a row an
 * update leaves unchanged as matched but not changed, and the driver reports
 * the matched count (its FOUND_ROWS flag). So saving a mapping unchanged is
 * not taken for a conflict.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, connectors, mappings, ontologyClasses, ontologyModules, workspaces } from "@db/schema";
import { appRouter } from "../../router";
import { closeDb, getDb } from "../../queries/connection";
import { createMockContext, mockOntologistUser, mockWorkspaceBeta } from "../testHarness";
import { emptyDatabase } from "./database";

const B = mockWorkspaceBeta;
const at = new Date("2026-01-01T00:00:00Z");
const ontologist = () =>
  appRouter.createCaller(
    createMockContext({
      user: mockOntologistUser,
      workspace: B,
      membership: { id: 902, workspaceId: B.id, userId: mockOntologistUser.id, role: "ontologist", moduleScope: null, createdAt: at },
    }),
  );
const people = {
  id: 200,
  name: "People",
  connectorId: 2,
  moduleKey: "hr",
  sourceTable: "people",
  classIri: "hr:Person",
  columnMap: { subject: "hr:person/{id}" },
  status: "active" as const,
  shaclMode: "block" as const,
};

beforeAll(async () => {
  await emptyDatabase();
  const db = getDb();
  await db.insert(workspaces).values({ id: B.id, name: B.name, slug: B.slug });
  await db.insert(ontologyModules).values({ id: 20, workspaceId: B.id, key: "hr", name: "HR", prefix: "hr", color: "#0ea5e9", version: "1.0" });
  await db.insert(ontologyClasses).values({ moduleId: 20, iri: "hr:Person", label: "Person" });
  await db.insert(connectors).values({ id: 2, workspaceId: B.id, name: "B HRIS", type: "csv" });
  await db
    .insert(mappings)
    .values({ id: 200, connectorId: 2, moduleId: 20, name: "People", sourceTable: "people", classIri: "hr:Person", status: "active", shaclMode: "block" });
});
afterAll(() => closeDb());

describe("saving a mapping on a real MySQL", () => {
  it("saves it unchanged, again and again, without a conflict", async () => {
    await ontologist().mapping.upsertMapping(people);
    await ontologist().mapping.upsertMapping(people);
    await ontologist().mapping.upsertMapping(people);

    const [m] = await getDb().select().from(mappings).where(eq(mappings.id, 200));
    expect(m).toMatchObject({ name: "People", shaclMode: "block", columnMapJson: expect.objectContaining({ subject: "hr:person/{id}" }) });
    expect(await getDb().select().from(auditLog)).toHaveLength(3);
  });

  it("and saves a change, recording a switched SHACL check as such", async () => {
    await ontologist().mapping.upsertMapping({ ...people, name: "People (HR)", shaclMode: "warn" });

    const [m] = await getDb().select().from(mappings).where(eq(mappings.id, 200));
    expect(m).toMatchObject({ name: "People (HR)", shaclMode: "warn" });
    const [last] = await getDb().select().from(auditLog).orderBy(auditLog.id).limit(1).offset(3);
    expect(last.payloadJson).toMatchObject({
      action: "Updated mapping 'People (HR)': its SHACL check now only warns",
      payload: { shaclMode: "warn", shaclModeWas: "block" },
    });
  });
});
