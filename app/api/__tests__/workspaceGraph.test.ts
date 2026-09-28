import { describe, it, expect } from "vitest";
import {
  workspaceEngineLockName,
  graphReadFailure,
  shaclResultOf,
  READ_WAIT_SECONDS,
  BACKGROUND_WAIT_SECONDS,
  CATCH_UP_HOLD_MS,
  GraphNotReady,
} from "../services/workspaceGraph";
import { EngineHostRefusal, EngineHostUnavailable } from "../services/engineHostClient";
import { LockUnavailable } from "../lib/namedLock";
import type { ShaclReport } from "../services/engineHost/types";

describe("workspaceGraph", () => {
  it("derives consistent lock name for a workspace engine", () => {
    const lock1 = workspaceEngineLockName("mysql://user:pass@localhost:3306/ontos_db", "http://127.0.0.1:8086", 42);
    const lock2 = workspaceEngineLockName("mysql://user:pass@localhost:3306/ontos_db", "http://127.0.0.1:8086", 42);
    const lockOtherWs = workspaceEngineLockName("mysql://user:pass@localhost:3306/ontos_db", "http://127.0.0.1:8086", 99);
    expect(lock1).toBe(lock2);
    expect(lock1).not.toBe(lockOtherWs);
    expect(lock1).match(/^ontos:wsengine:/);
  });

  describe("graphReadFailure", () => {
    it("translates bad request / syntax refusals (400, 422) to status 400", () => {
      const refusal400 = new EngineHostRefusal(400, "malformed", "syntax error at line 1");
      const refusal422 = new EngineHostRefusal(422, "not_select", "Only SELECT queries allowed");
      
      expect(graphReadFailure(refusal400)).toEqual({
        status: 400,
        message: "SPARQL execution failed: syntax error at line 1",
      });
      expect(graphReadFailure(refusal422)).toEqual({
        status: 400,
        message: "SPARQL execution failed: Only SELECT queries allowed",
      });
    });

    it("translates GraphNotReady, unavailable and lock failures to status 503", () => {
      const notReady = new GraphNotReady("store catching up");
      const unavail = new EngineHostUnavailable("host down", 503, "host_unavailable", 3500);
      const lockUnavail = new LockUnavailable("lock held");

      expect(graphReadFailure(notReady)).toEqual({
        status: 503,
        message: "The workspace's graph could not be read just now: store catching up",
        retryAfterSeconds: 2,
      });

      expect(graphReadFailure(unavail)).toEqual({
        status: 503,
        message: "The workspace's graph could not be read just now: host down",
        retryAfterSeconds: 4,
      });

      expect(graphReadFailure(lockUnavail)).toEqual({
        status: 503,
        message: "The workspace's graph could not be read just now: lock held",
        retryAfterSeconds: 2,
      });
    });

    it("rethrows unhandled or programming errors", () => {
      const boom = new Error("unexpected internal exception");
      expect(() => graphReadFailure(boom)).toThrow(boom);
    });
  });

  describe("shaclResultOf", () => {
    it("converts engine host ShaclReport into ShaclValidationResult", () => {
      const report: ShaclReport = {
        conforms: false,
        focus_nodes: 5,
        violation_count: 1,
        violations: [
          {
            constraint: "MinCountConstraintComponent",
            focus_node: "ex:Person1",
            path: "ex:email",
            severity: "Violation",
            message: "Missing email",
          },
        ],
      };

      const result = shaclResultOf(report);
      expect(result.conforms).toBe(false);
      expect(result.focusNodes).toBe(5);
      expect(result.violationCount).toBe(1);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toEqual({
        constraint: "MinCountConstraintComponent",
        focusNode: "ex:Person1",
        path: "ex:email",
        severity: "Violation",
        message: "Missing email",
        value: undefined,
      });
    });

    it("treats null conforms with 0 violations as conforming", () => {
      const report: ShaclReport = {
        conforms: null,
        focus_nodes: 0,
        violation_count: 0,
        violations: [],
      };
      const result = shaclResultOf(report);
      expect(result.conforms).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  it("exports sensible wait constants", () => {
    expect(READ_WAIT_SECONDS).toBeGreaterThan(0);
    expect(BACKGROUND_WAIT_SECONDS).toBeGreaterThan(0);
    expect(CATCH_UP_HOLD_MS).toBeGreaterThan(60000);
  });
});