// @vitest-environment jsdom
/**
 * The simulation control on the Twins page. A tick writes twin state, which
 * the API allows editors and above; for anyone else the control is disabled
 * and says why, instead of failing on every tick.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TickControl, type TickControlProps } from "../components/twins/TickControl";

afterEach(cleanup);

function renderControl(overrides: Partial<TickControlProps>) {
  const props: TickControlProps = {
    tickCount: 3,
    lastTickAt: null,
    autoTick: false,
    onAutoTickChange: vi.fn(),
    onTick: vi.fn(),
    ticking: false,
    canSimulate: true,
    ...overrides,
  };
  render(<TickControl {...props} />);
  return {
    props,
    tick: screen.getByRole("button", { name: /tick/i }) as HTMLButtonElement,
    auto: screen.getByRole("switch", { name: "Auto-tick every 2 seconds" }) as HTMLButtonElement,
  };
}

/** The text an element's aria-describedby points at, if any. */
const description = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? "") : "";
};

describe("TickControl", () => {
  it("lets someone who may simulate tick and switch auto-tick on", () => {
    const { props, tick, auto } = renderControl({ canSimulate: true });
    expect(tick.disabled).toBe(false);
    fireEvent.click(tick);
    expect(props.onTick).toHaveBeenCalledTimes(1);
    fireEvent.click(auto);
    expect(props.onAutoTickChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("AUTO · 2s")).toBeTruthy();
    expect(description(tick)).toBe("");
  });

  it("is view-only for anyone else, and says why", () => {
    const { props, tick, auto } = renderControl({ canSimulate: false, autoTick: true });
    expect(tick.disabled).toBe(true);
    expect(auto.disabled).toBe(true);
    expect(auto.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(tick);
    fireEvent.click(auto);
    expect(props.onTick).not.toHaveBeenCalled();
    expect(props.onAutoTickChange).not.toHaveBeenCalled();
    expect(screen.getByText("VIEW ONLY")).toBeTruthy();
    expect(description(tick)).toMatch(/editor role or above/);
    expect(description(auto)).toMatch(/editor role or above/);
  });
});
