// @vitest-environment jsdom
/**
 * The mapping editor keeps a mapping's SHACL mode across a save. A mapping
 * set to block is saved as block when the toggle is left alone: a reset to
 * warn on an unrelated save would quietly let imports that break the shapes
 * in. A new mapping starts at warn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { MappingEditor } from "@/components/mapping/MappingEditor";
import type { ConnectorLike, MappingLike } from "@/components/mapping/utils";

const calls: { path: string; input: unknown }[] = [];
let canRelaxShaclCheck = true;
const answers: Record<string, (input: unknown) => unknown> = {
  "mapping.capabilities": () => ({ canRelaxShaclCheck }),
  "ontology.listModules": () => [{ key: "hr", prefix: "hr", name: "HR" }],
  "ontology.listClasses": () => [{ iri: "hr:Person", label: "Person" }],
  "ontology.listProperties": () => [],
  "mapping.upsertMapping": (input) => ({ id: (input as { id?: number }).id ?? 101 }),
  "mapping.listMappings": () => [],
};
const fakeLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    calls.push({ path: op.path, input: op.input });
    observer.next({ result: { type: "data", data: answers[op.path]?.(op.input) ?? null } } as never);
    observer.complete();
  });

const connector: ConnectorLike = { id: 1, name: "HRIS", type: "csv", status: "connected", configJson: { filename: "p.csv" } };
const people: MappingLike = {
  id: 100, connectorId: 1, name: "People", sourceTable: "p.csv", classIri: "hr:Person", status: "active", shaclMode: "block",
  columnMapJson: { subject: "hr:person/{id}" }, module: { key: "hr" },
};

function renderEditor(mappings: MappingLike[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [fakeLink] });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MappingEditor
          connector={connector}
          mappings={mappings}
          csvData={null}
          onRequestCsvUpload={vi.fn()}
          onPreview={vi.fn()}
          onRunSync={vi.fn()}
          activeMappingIds={new Set()}
          onError={vi.fn()}
        />
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

const toggle = () => screen.getByRole("checkbox", { name: "Block imports that fail SHACL" }) as HTMLInputElement;
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
const saved = () => calls.filter((c) => c.path === "mapping.upsertMapping").map((c) => c.input);

afterEach(() => {
  cleanup();
  calls.length = 0;
  canRelaxShaclCheck = true;
});

describe("MappingEditor", () => {
  it("opens a mapping set to block as block, and saves it as block when the toggle is left alone", async () => {
    renderEditor([people]);
    expect(toggle().checked).toBe(true);
    await save();
    expect(saved()).toEqual([expect.objectContaining({ id: 100, shaclMode: "block" })]);
  });

  it("saves the mode the toggle is switched to", async () => {
    renderEditor([people]);
    // Locked until the server says this person may switch a blocking check off.
    await waitFor(() => expect(toggle().disabled).toBe(false));
    fireEvent.click(toggle());
    expect(toggle().checked).toBe(false);
    await save();
    expect(saved()).toEqual([expect.objectContaining({ id: 100, shaclMode: "warn" })]);
  });

  it("keeps a blocking check locked for someone who may not switch it back to warn, and says who may", async () => {
    canRelaxShaclCheck = false;
    renderEditor([people]);
    await waitFor(() => expect(calls.some((c) => c.path === "mapping.capabilities")).toBe(true));
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(true);
    expect(toggle().closest("label")?.title).toMatch(/Only ontologists and admins can switch it back to warn/);
    await save();
    expect(saved()).toEqual([expect.objectContaining({ shaclMode: "block" })]);
  });

  it("starts a new mapping at warn", async () => {
    renderEditor([]);
    expect(toggle().checked).toBe(false);
    await screen.findByRole("option", { name: "hr:Person" });
    fireEvent.change(screen.getByRole("combobox", { name: "Target class" }), { target: { value: "hr:Person" } });
    await save();
    expect(saved()).toEqual([expect.objectContaining({ classIri: "hr:Person", shaclMode: "warn" })]);
  });
});
