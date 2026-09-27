// @vitest-environment jsdom
/**
 * The Update password dialog, against a fake server: it sends the password
 * once, to the procedure that seals it, closes on success, and shows the
 * server's reason when it is refused.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { UpdatePasswordDialog } from "@/components/mapping/UpdatePasswordDialog";

const calls: { path: string; input: unknown }[] = [];
let refuse: string | null = null;
const fakeLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    calls.push({ path: op.path, input: op.input });
    if (op.path === "mapping.setConnectorPassword" && refuse) {
      observer.error(TRPCClientError.from({ error: { message: refuse, code: -32000, data: { code: "FORBIDDEN", httpStatus: 403 } } } as never));
      return;
    }
    observer.next({ result: { type: "data", data: op.path === "mapping.listConnectors" ? [] : { id: 7 } } } as never);
    observer.complete();
  });

function renderDialog(onOpenChange = vi.fn(), onUpdated = vi.fn()) {
  const queryClient = new QueryClient();
  const client = trpc.createClient({ links: [fakeLink] });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <UpdatePasswordDialog connector={{ id: 7, name: "Contracts DB" }} onOpenChange={onOpenChange} onUpdated={onUpdated} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return { onOpenChange, onUpdated };
}

afterEach(() => {
  cleanup();
  calls.length = 0;
  refuse = null;
});

describe("UpdatePasswordDialog", () => {
  it("sends the password for this connector once, then closes", async () => {
    const { onOpenChange, onUpdated } = renderDialog();
    expect(screen.getByText(/Contracts DB/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new-pw" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Save password/ })));
    expect(calls.filter((c) => c.path === "mapping.setConnectorPassword")).toEqual([
      { path: "mapping.setConnectorPassword", input: { connectorId: 7, password: "new-pw" } },
    ]);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends nothing without a password, and shows the server's reason when it refuses", async () => {
    const { onOpenChange } = renderDialog();
    expect((screen.getByRole("button", { name: /Save password/ }) as HTMLButtonElement).disabled).toBe(true);
    refuse = "Only workspace admins can do this.";
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new-pw" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Save password/ })));
    expect(screen.getByRole("alert").textContent).toBe("Only workspace admins can do this.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
