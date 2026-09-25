import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import {
  createActionType,
  DefinitionInvalid,
  listActionTypes,
  updateActionType,
  ActionTypeConflict,
} from "../services/actions/definitions";
import { loadActionType, prepareSubmission, submitAction, SubmissionConflict } from "../services/actions/service";
import {
  createMockContext,
  mockAdminMembership,
  mockAdminUser,
  mockOntologistMembership,
  mockOntologistUser,
  mockViewerMembership,
  mockViewerUser,
  mockWorkspace,
} from "./testHarness";

vi.mock("../services/actions/definitions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/actions/definitions")>()),
  createActionType: vi.fn(),
  updateActionType: vi.fn(),
  setActionTypeStatus: vi.fn(),
  listActionTypes: vi.fn(),
  listVersions: vi.fn(async () => []),
}));
vi.mock("../services/actions/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/actions/service")>()),
  loadActionType: vi.fn(),
  prepareSubmission: vi.fn(),
  submitAction: vi.fn(),
}));

const as = (role: "viewer" | "editor" | "ontologist" | "admin") =>
  appRouter.createCaller(
    createMockContext(
      role === "viewer"
        ? { user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace }
        : role === "editor"
          ? { user: { ...mockViewerUser, role: "user" }, membership: { ...mockViewerMembership, role: "editor" }, workspace: mockWorkspace }
          : role === "ontologist"
            ? { user: mockOntologistUser, membership: mockOntologistMembership, workspace: mockWorkspace }
            : { user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace },
    ),
  );

const definition = {
  parameters: [{ name: "employee", label: "Employee", type: "object", classIri: "hr:Person", required: true }],
  criteria: [],
  rules: [{ kind: "modify_object", object: "employee", properties: { status: "active" } }],
  validation: { shacl: false },
  sideEffects: [],
};

const actionType = {
  id: 5,
  workspaceId: mockWorkspace.id,
  moduleId: 1,
  key: "reactivate",
  displayName: "Reactivate",
  description: null,
  status: "active",
  minRole: "ontologist",
  version: 2,
  definitionJson: definition,
  createdBy: "x",
  updatedBy: "x",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const loaded = { actionType, module: { id: 1, key: "hr", name: "HR", color: "#fff" }, definition };
const emptyPlan = { creates: [], modifies: [], deletes: [], linkAdds: [], linkRemoves: [] };
const prepared = (problems: { code: string; message: string }[] = []) => ({
  loaded,
  values: { employee: "hr:Person/E-1" },
  objects: new Map(),
  criteria: [],
  plan: emptyPlan,
  shacl: { status: "skipped", violations: [] },
  problems,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("authoring action types", () => {
  it("is for admins and ontologists only", async () => {
    const input = { key: "reactivate", displayName: "Reactivate", moduleKey: "hr", minRole: "editor" as const, status: "draft" as const, definition };
    await expect(as("viewer").actions.createType(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("editor").actions.createType(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createActionType).not.toHaveBeenCalled();

    vi.mocked(createActionType).mockResolvedValue(actionType as never);
    await expect(as("ontologist").actions.createType(input)).resolves.toMatchObject({ key: "reactivate" });
    expect(createActionType).toHaveBeenCalledWith(mockWorkspace.id, mockOntologistUser.name, input);
  });

  it("reports an invalid definition as a bad request, and a lost race as a conflict", async () => {
    vi.mocked(updateActionType).mockRejectedValueOnce(new DefinitionInvalid([{ path: "rules.0.object", message: "no such parameter" }]));
    await expect(as("admin").actions.updateType({ key: "reactivate", expectedVersion: 2, definition })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "rules.0.object: no such parameter",
    });
    vi.mocked(updateActionType).mockRejectedValueOnce(new ActionTypeConflict("someone saved first"));
    await expect(as("admin").actions.updateType({ key: "reactivate", expectedVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("tells the client who can author, from the workspace role", async () => {
    await expect(as("viewer").actions.capabilities()).resolves.toEqual({ canAuthor: false });
    await expect(as("editor").actions.capabilities()).resolves.toEqual({ canAuthor: false });
    await expect(as("ontologist").actions.capabilities()).resolves.toEqual({ canAuthor: true });
    await expect(as("admin").actions.capabilities()).resolves.toEqual({ canAuthor: true });
  });

  it("checks a definition for anyone who can author, listing every problem", async () => {
    const res = await as("ontologist").actions.validateDefinition({ definition: { ...definition, rules: [] } });
    expect(res.ok).toBe(false);
    expect(res.problems[0]).toMatchObject({ path: "rules" });
    await expect(as("viewer").actions.validateDefinition({ definition })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("listing action types", () => {
  it("says, per caller, whether each can be submitted and why not", async () => {
    vi.mocked(listActionTypes).mockResolvedValue([
      { ...actionType, module: { key: "hr", name: "HR", color: "#fff" }, definition, submissions: { applied: 1, rejected: 0, lastAt: null } },
    ] as never);
    const [forViewer] = await as("viewer").actions.listTypes();
    expect(forViewer).toMatchObject({ canSubmit: false, deniedBecause: "Submitting this action needs the ontologist role or higher" });
    const [forOntologist] = await as("ontologist").actions.listTypes();
    expect(forOntologist).toMatchObject({ canSubmit: true, deniedBecause: null });
  });
});

describe("submitting an action", () => {
  it("answers a rejection with the record, not an error", async () => {
    vi.mocked(loadActionType).mockResolvedValue(loaded as never);
    const rejected = { id: 9, status: "rejected" };
    vi.mocked(submitAction).mockResolvedValue({
      submission: rejected,
      prepared: prepared([{ code: "criterion_failed", message: "already active" }]),
    } as never);
    const res = await as("ontologist").actions.submit({ key: "reactivate", params: { employee: "hr:Person/E-1" } });
    expect(res.submission).toEqual(rejected);
    expect(res.problems).toEqual([{ code: "criterion_failed", message: "already active" }]);
    expect(submitAction).toHaveBeenCalledWith(
      mockWorkspace.id,
      loaded,
      expect.objectContaining({ name: mockOntologistUser.name, userId: mockOntologistUser.id, memberRole: "ontologist" }),
      { employee: "hr:Person/E-1" },
    );
  });

  it("refuses without a record when the caller may not submit it", async () => {
    vi.mocked(loadActionType).mockResolvedValue(loaded as never);
    vi.mocked(submitAction).mockResolvedValue({
      submission: null,
      prepared: prepared([{ code: "forbidden_role", message: "Submitting this action needs the ontologist role or higher" }]),
    } as never);
    await expect(as("viewer").actions.submit({ key: "reactivate", params: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports objects that kept changing as a conflict", async () => {
    vi.mocked(loadActionType).mockResolvedValue(loaded as never);
    vi.mocked(submitAction).mockRejectedValue(new SubmissionConflict("hr:Person/E-1 changed"));
    await expect(as("admin").actions.submit({ key: "reactivate", params: {} })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("previews without applying, and says whether it could be applied", async () => {
    vi.mocked(loadActionType).mockResolvedValue(loaded as never);
    vi.mocked(prepareSubmission).mockResolvedValue(prepared() as never);
    await expect(as("ontologist").actions.preview({ key: "reactivate", params: {} })).resolves.toMatchObject({ canApply: true });
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("says when there is no such action type", async () => {
    vi.mocked(loadActionType).mockResolvedValue(null);
    await expect(as("admin").actions.preview({ key: "nope", params: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
