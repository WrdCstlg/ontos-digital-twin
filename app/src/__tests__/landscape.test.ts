import { describe, expect, it } from "vitest";
import { STATUS_LABEL, capabilities, links, roadmap, services } from "../lib/landscape";

/**
 * lib/landscape.ts is hand-maintained and feeds both the Landscape page and the
 * README summary. These checks keep its cross-references intact.
 */
describe("landscape data integrity", () => {
  const serviceIds = services.map((s) => s.id);
  const increments = new Set(roadmap.map((r) => r.increment));

  it("gives every service a unique id", () => {
    expect(new Set(serviceIds).size).toBe(serviceIds.length);
  });

  it("points every link at services that exist", () => {
    const known = new Set(serviceIds);
    const dangling = links.flatMap((l) =>
      [l.from, l.to].filter((id) => !known.has(id)).map((id) => `${l.from} → ${l.to}: unknown service '${id}'`),
    );
    expect(dangling).toEqual([]);
  });

  it("has a label for every capability status in use", () => {
    const unlabelled = capabilities.filter((c) => !STATUS_LABEL[c.status]?.trim()).map((c) => c.area);
    expect(unlabelled).toEqual([]);
  });

  it("names a roadmap increment on every planned capability", () => {
    const broken = capabilities
      .filter((c) => c.status === "planned" && (c.increment == null || !increments.has(c.increment)))
      .map((c) => `${c.area} (increment ${c.increment ?? "missing"})`);
    expect(broken).toEqual([]);
  });

  it("ties every service's `since` to a roadmap increment", () => {
    const broken = services
      .filter((s) => s.since != null)
      .filter((s) => {
        const n = Number(s.since!.match(/\d+/)?.[0]);
        return !increments.has(n);
      })
      .map((s) => `${s.id}: ${s.since}`);
    expect(broken).toEqual([]);
  });
});
