// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Landscape from "../pages/Landscape";
import {
  LANDSCAPE_AS_OF,
  STATUS_LABEL,
  capabilities,
  links,
  roadmap,
  services,
} from "../lib/landscape";

function renderPage() {
  return render(<Landscape />);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// This vitest setup has no globals, so testing-library does not unmount on its own.
afterEach(cleanup);

describe("Landscape page (real data)", () => {
  it("states the as-of date and that the Foundry column is a reading, not a benchmark", () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Landscape" })).toBeTruthy();
    expect(container.textContent).toContain(LANDSCAPE_AS_OF);
    expect(container.textContent).toMatch(/not a benchmark/);
  });

  it("draws every service and labels every link in the diagram", () => {
    const { container } = renderPage();
    const svg = container.querySelector("svg[role='img']")!;
    expect(svg).toBeTruthy();
    const svgText = svg.textContent ?? "";
    for (const s of services) expect(svgText).toContain(s.name);
    for (const l of links) expect(svgText).toContain(l.label);
    expect(svg.querySelectorAll("line")).toHaveLength(links.length);
    for (const s of services.filter((x) => x.since)) expect(svgText).toContain(s.since!);
  });

  it("shows a service's runtime and responsibilities when it is selected", () => {
    renderPage();
    const target = services[services.length - 1];
    fireEvent.click(within(screen.getByRole("group", { name: "Services" })).getByRole("button", { name: new RegExp(escapeRe(target.name)) }));
    const panel = document.querySelector("aside")!;
    expect(panel.textContent).toContain(target.runtime.replace(/`/g, ""));
    for (const r of target.responsibilities) expect(panel.textContent).toContain(r.replace(/`/g, ""));
  });

  it("lists the roadmap in increment order with each status", () => {
    const { container } = renderPage();
    const steps = within(screen.getByRole("list", { name: "Roadmap" })).getAllByRole("listitem");
    const ordered = [...roadmap].sort((a, b) => a.increment - b.increment);
    expect(steps).toHaveLength(ordered.length);
    ordered.forEach((r, i) => expect(steps[i].textContent).toContain(r.title));
    expect(container.textContent).toContain(ordered[0].summary);
  });

  it("renders every capability, and filters by status and by text", () => {
    renderPage();
    expect(screen.getAllByTestId("capability-row")).toHaveLength(capabilities.length);

    for (const c of capabilities.filter((x) => x.status === "planned" && x.increment != null)) {
      expect(document.body.textContent).toContain(`${STATUS_LABEL.planned} · increment ${c.increment}`);
    }

    const gapCount = capabilities.filter((c) => c.status === "gap").length;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${STATUS_LABEL.gap}\\s*${gapCount}$`) }));
    expect(screen.getAllByTestId("capability-row")).toHaveLength(gapCount);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^All\\s*${capabilities.length}$`) }));
    const term = capabilities[0].area;
    fireEvent.change(screen.getByLabelText("Filter capabilities"), { target: { value: term } });
    const expected = capabilities.filter((c) =>
      `${c.area} ${c.palantir} ${c.ontos}`.toLowerCase().includes(term.toLowerCase()),
    ).length;
    expect(screen.getAllByTestId("capability-row")).toHaveLength(expected);
  });
});
