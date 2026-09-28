// @vitest-environment jsdom
/**
 * An insight card offers "Acknowledge" only to someone who may acknowledge
 * (editors and above): the page leaves the handler out for a viewer, since
 * acknowledging takes the finding off everyone's open list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InsightCard } from "../components/insights/InsightCard";
import type { InsightRow } from "../components/insights/types";

afterEach(cleanup);

const insight: InsightRow = {
  id: 7, workspaceId: 2, type: "anomaly", severity: "risk", ruleId: "control-without-evidence-90d", title: "Control without evidence",
  summary: null, evidenceJson: { nodeIds: [1], edgeIds: [] }, status: "open", createdAt: "2026-01-01T00:00:00Z",
};

describe("InsightCard", () => {
  it("offers Acknowledge when it is given a handler, and calls it", () => {
    const onAcknowledge = vi.fn();
    render(<InsightCard insight={insight} onTrace={vi.fn()} onWatch={vi.fn()} onAcknowledge={onAcknowledge} />);
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge/ }));
    expect(onAcknowledge).toHaveBeenCalledWith(insight);
  });

  it("offers no Acknowledge without one, as for a viewer, and still lets them trace the evidence", () => {
    render(<InsightCard insight={insight} onTrace={vi.fn()} onWatch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Trace evidence/ })).toBeTruthy();
  });
});
