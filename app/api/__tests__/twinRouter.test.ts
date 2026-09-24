import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import { TWIN_MODELS, dtmiFor } from "../services/twinModels";
import { writeAudit } from "../services/audit";
import {
  createMockContext,
  mockViewerUser,
  mockViewerMembership,
  mockWorkspace,
} from "./testHarness";

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ affectedRows: 3 }]),
    })),
  })),
}));

vi.mock("../services/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/audit")>();
  return { ...actual, writeAudit: vi.fn().mockResolvedValue(undefined) };
});

/* DTDL v3 syntax rules (https://github.com/Azure/opendigitaltwins-dtdl/blob/master/DTDL/v3/DTDL.v3.md) */
const DTMI_RE =
  /^dtmi:[A-Za-z](?:[A-Za-z0-9_]*[A-Za-z0-9])?(?::[A-Za-z](?:[A-Za-z0-9_]*[A-Za-z0-9])?)*;[1-9][0-9]{0,8}$/;
const NAME_RE = /^[A-Za-z](?:[A-Za-z0-9_]{0,510}[A-Za-z0-9])?$/;

type DtdlContent = {
  "@type": string | string[];
  "@id"?: string;
  name: string;
  schema?: string;
  unit?: string;
  target?: string;
  minMultiplicity?: number;
  maxMultiplicity?: number;
};
type DtdlIface = {
  "@context": string | string[];
  "@id": string;
  "@type": string;
  extends?: string;
  contents: DtdlContent[];
};

async function exportAllInterfaces(): Promise<DtdlIface[]> {
  const caller = appRouter.createCaller(
    createMockContext({
      user: mockViewerUser,
      membership: mockViewerMembership,
      workspace: mockWorkspace,
    }),
  );
  const result = await caller.twin.exportDtdl();
  return JSON.parse(result.content) as DtdlIface[];
}

const typesOf = (c: DtdlContent) => (Array.isArray(c["@type"]) ? c["@type"] : [c["@type"]]);

describe("Twin Router & DTDL v3 Export Tests", () => {
  it("exports all registered twin models as DTDL v3 interfaces when no IRI is specified", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    const result = await caller.twin.exportDtdl();

    expect(result.forTwin).toBeNull();
    expect(result.models).toHaveLength(TWIN_MODELS.length);
    expect(result.models).toContain(dtmiFor("ShipmentTwin"));
    expect(result.models).toContain(dtmiFor("WarehouseTwin"));
    expect(result.models).toContain(dtmiFor("EquipmentTwin"));

    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(TWIN_MODELS.length);

    // Validate DTDL v3 Interface structure on each exported model
    for (const iface of parsed) {
      expect([iface["@context"]].flat()[0]).toBe("dtmi:dtdl:context;3");
      expect(iface["@type"]).toBe("Interface");
      expect(iface["@id"]).toMatch(/^dtmi:acme:[a-z]+:[A-Za-z0-9]+;1$/);
      expect(typeof iface.displayName).toBe("string");
      expect(Array.isArray(iface.contents)).toBe(true);

      for (const item of iface.contents) {
        // A co-typed element lists its primary type first, e.g. ["Telemetry", "Temperature"].
        const [primary] = [item["@type"]].flat();
        expect(["Property", "Telemetry", "Relationship", "Component"]).toContain(primary);
        expect(typeof item.name).toBe("string");

        if (primary === "Telemetry") {
          expect(item.schema).toBe("double");
        }
        if (primary === "Relationship") {
          expect(item["@id"]).toBeDefined();
        }
      }
    }
  });

  it("co-types telemetry with QuantitativeTypes semantic types, and gives a unit only with one", async () => {
    const interfaces = await exportAllInterfaces();
    const telemetry = (model: string, name: string) =>
      interfaces
        .find((i) => i["@id"] === dtmiFor(model))
        ?.contents.find((c) => typesOf(c).includes("Telemetry") && c.name === name);

    const shipment = interfaces.find((i) => i["@id"] === dtmiFor("ShipmentTwin"));
    expect(shipment?.["@context"]).toEqual(["dtmi:dtdl:context;3", "dtmi:dtdl:extension:quantitativeTypes;1"]);

    expect(telemetry("ShipmentTwin", "temperature")).toMatchObject({
      "@type": ["Telemetry", "Temperature"],
      unit: "degreeCelsius",
    });
    expect(telemetry("ShipmentTwin", "etaMinutes")).toMatchObject({
      "@type": ["Telemetry", "TimeSpan"],
      unit: "minute",
    });
    expect(telemetry("FacilityTwin", "humidity")).toMatchObject({
      "@type": ["Telemetry", "RelativeHumidity"],
      unit: "percent",
    });

    // No semantic type covers a plain percentage, so no unit is allowed.
    const battery = telemetry("EquipmentTwin", "batteryLevel");
    expect(battery?.["@type"]).toBe("Telemetry");
    expect(battery?.unit).toBeUndefined();
  });

  it("returns the deletion count from pruneStateHistory and records it in the audit entry", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: { ...mockViewerMembership, role: "admin" },
        workspace: mockWorkspace,
      }),
    );

    const result = await caller.twin.pruneStateHistory({ olderThanDays: 30 });

    expect(result.deletedCount).toBe(3);
    expect(typeof result.cutoff).toBe("string");

    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditEntry = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditEntry.payload).toMatchObject({ olderThanDays: 30, deletedCount: 3 });
    expect(auditEntry.action).toContain("3 rows deleted");
  });

  it("exports a Component entry for every declared component, whose schema is another exported interface", async () => {
    const interfaces = await exportAllInterfaces();
    const byId = new Map(interfaces.map((i) => [i["@id"], i]));
    const withComponents = TWIN_MODELS.filter((m) => m.components.length > 0);
    expect(withComponents.length).toBeGreaterThan(0);

    for (const model of withComponents) {
      const iface = byId.get(dtmiFor(model.name));
      expect(iface, `interface for ${model.name}`).toBeDefined();
      const components = iface!.contents.filter((c) => typesOf(c).includes("Component"));
      expect(components.map((c) => c.name).sort()).toEqual(model.components.map((c) => c.name).sort());

      for (const declared of model.components) {
        const exported = components.find((c) => c.name === declared.name)!;
        expect(exported.schema).toBe(dtmiFor(declared.schemaModel));
        const schemaIface = byId.get(exported.schema!);
        expect(schemaIface, `${model.name}.${declared.name} schema ${exported.schema}`).toBeDefined();
        expect(schemaIface!["@type"]).toBe("Interface");
        expect(exported.schema).not.toBe(iface!["@id"]);
      }
    }
  });

  it("every exported interface satisfies DTDL v3 context, identifier, naming and reference rules", async () => {
    const interfaces = await exportAllInterfaces();
    const ids = new Set(interfaces.map((i) => i["@id"]));
    expect(ids.size).toBe(interfaces.length);
    const byId = new Map(interfaces.map((i) => [i["@id"], i]));

    for (const iface of interfaces) {
      const ctx = Array.isArray(iface["@context"]) ? iface["@context"] : [iface["@context"]];
      expect(ctx[0]).toBe("dtmi:dtdl:context;3");
      expect(iface["@id"]).toMatch(DTMI_RE);
      if (iface.extends) {
        expect(iface.extends).toMatch(DTMI_RE);
        expect(ids.has(iface.extends), `${iface["@id"]} extends ${iface.extends}`).toBe(true);
      }

      const names = iface.contents.map((c) => c.name);
      for (const name of names) expect(name, `${iface["@id"]} content name`).toMatch(NAME_RE);
      expect(new Set(names).size, `duplicate names in ${iface["@id"]}`).toBe(names.length);

      // names must not collide with contents inherited through the extends chain either
      const inherited: string[] = [];
      const visited = new Set<string>([iface["@id"]]);
      for (let p = iface.extends; p; p = byId.get(p)?.extends) {
        expect(visited.has(p), `extends cycle through ${p}`).toBe(false);
        visited.add(p);
        inherited.push(...(byId.get(p)?.contents.map((c) => c.name) ?? []));
      }
      for (const name of names) {
        expect(inherited, `${iface["@id"]}.${name} redeclares an inherited name`).not.toContain(name);
      }

      for (const item of iface.contents) {
        if (item["@id"]) expect(item["@id"]).toMatch(DTMI_RE);
        if (typesOf(item).includes("Relationship") && item.target !== undefined) {
          expect(item.target).toMatch(DTMI_RE);
          expect(ids.has(item.target), `${iface["@id"]}.${item.name} target ${item.target}`).toBe(true);
        }
        if (typesOf(item).includes("Component")) {
          expect(item.schema).toMatch(DTMI_RE);
          expect(ids.has(item.schema!)).toBe(true);
        }
      }
    }
  });

  it("no Component schema itself contains a Component (DTDL v3 forbids nesting)", async () => {
    const interfaces = await exportAllInterfaces();
    const byId = new Map(interfaces.map((i) => [i["@id"], i]));
    for (const iface of interfaces) {
      for (const comp of iface.contents.filter((c) => typesOf(c).includes("Component"))) {
        const nested = byId.get(comp.schema!)?.contents.filter((c) => typesOf(c).includes("Component")) ?? [];
        expect(nested, `${iface["@id"]}.${comp.name} → ${comp.schema}`).toEqual([]);
      }
    }
  });

  it("every Relationship minMultiplicity is 0 and maxMultiplicity >= 1 (DTDL v3 limits)", async () => {
    const interfaces = await exportAllInterfaces();
    for (const iface of interfaces) {
      for (const rel of iface.contents.filter((c) => typesOf(c).includes("Relationship"))) {
        if (rel.minMultiplicity !== undefined) expect(rel.minMultiplicity, `${iface["@id"]}.${rel.name}`).toBe(0);
        if (rel.maxMultiplicity !== undefined) expect(rel.maxMultiplicity).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("Telemetry with a unit declares a semantic type and the QuantitativeTypes extension", async () => {
    const interfaces = await exportAllInterfaces();
    for (const iface of interfaces) {
      for (const t of iface.contents.filter((c) => typesOf(c).includes("Telemetry") && c.unit !== undefined)) {
        expect(typesOf(t).length, `${iface["@id"]}.${t.name} @type`).toBeGreaterThan(1);
        expect(iface["@context"]).toContain("dtmi:dtdl:extension:quantitativeTypes;1");
      }
    }
  });

  it("rejects unauthenticated caller from exporting DTDL models", async () => {
    const caller = appRouter.createCaller(
      createMockContext({ user: null, workspace: null, membership: null }),
    );

    await expect(caller.twin.exportDtdl()).rejects.toThrow("Authentication required");
  });
});
