import { describe, expect, it } from "vitest";
import { auditHash, auditRecord, canonicalize } from "../services/audit";

/** What verifyAuditChain computes from a stored row. */
function verifyHash(prevHash: string | null, stored: Record<string, unknown>) {
  return auditHash(
    prevHash,
    canonicalize({
      actor: stored.actor,
      action: stored.action,
      entityType: stored.entityType,
      entityId: stored.entityId ?? null,
      payload: stored.payload ?? null,
    }),
  );
}

/** A MySQL JSON column keeps what JSON keeps. */
const throughJsonColumn = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

describe("auditRecord", () => {
  const fields = {
    actor: "R. Alvarez",
    action: "Applied action 'Renew contract' v1: changed 1",
    entityType: "action_submission",
    entityId: 8,
    payload: {
      result: { modified: [{ iri: "lgl:Contract/C-1", label: undefined, set: { endDate: { from: "2026-10-09", to: "2027-10-30" } } }] },
      at: new Date("2026-09-25T04:11:17Z"),
      problems: [{ code: "x", message: "y", path: undefined }],
    },
  };

  it("chains the payload as it will be stored, so verification reads back the same hash", () => {
    const prev = "a".repeat(64);
    const { payloadJson, hash } = auditRecord(prev, fields);
    expect(verifyHash(prev, throughJsonColumn(payloadJson))).toBe(hash);
    expect(payloadJson.payload).toEqual({
      result: { modified: [{ iri: "lgl:Contract/C-1", set: { endDate: { from: "2026-10-09", to: "2027-10-30" } } }] },
      at: "2026-09-25T04:11:17.000Z",
      problems: [{ code: "x", message: "y" }],
    });
  });

  it("would not verify if the hash were taken before the round trip", () => {
    const prev = null;
    const naive = auditHash(prev, canonicalize({ ...fields, entityId: fields.entityId, payload: fields.payload }));
    expect(verifyHash(prev, throughJsonColumn(auditRecord(prev, fields).payloadJson))).not.toBe(naive);
  });
});
