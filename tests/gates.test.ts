import { describe, it, expect } from "vitest";
import { resolvePolicy, evaluateGates, DEFAULT_POLICIES } from "../src/gates/index.js";

describe("resolvePolicy", () => {
  it("returns default policy for unknown domain", () => {
    const policy = resolvePolicy("unknown-domain");
    expect(policy).toEqual(DEFAULT_POLICIES["default"]);
  });

  it("returns migration policy for migration domain", () => {
    const policy = resolvePolicy("migration");
    expect(policy.hitl).toBe("required");
  });

  it("returns docs policy for docs domain", () => {
    const policy = resolvePolicy("docs");
    expect(policy.hitl).toBe("skip");
    expect(policy.qa).toBe("skip");
  });

  it("allows policy overrides", () => {
    const policy = resolvePolicy("custom", {
      custom: { scope: "required", ci: "required", qa: "skip", hitl: "skip" },
    });
    expect(policy.scope).toBe("required");
    expect(policy.hitl).toBe("skip");
  });
});

describe("evaluateGates", () => {
  it("blocks when a required gate fails", () => {
    const policy = resolvePolicy("migration");
    const results = evaluateGates(policy, { scope: true, ci: false, qa: true });
    const ciGate = results.find((r) => r.gate === "ci");
    expect(ciGate?.blocks).toBe(true);
  });

  it("blocks when a required gate has not run", () => {
    const policy = resolvePolicy("migration");
    const results = evaluateGates(policy, { ci: true });
    const hitlGate = results.find((r) => r.gate === "hitl");
    expect(hitlGate?.blocks).toBe(true);
  });

  it("does not block when all required gates pass", () => {
    const policy = resolvePolicy("migration");
    const results = evaluateGates(policy, {
      scope: true,
      ci: true,
      qa: true,
      hitl: true,
    });
    expect(results.every((r) => !r.blocks)).toBe(true);
  });

  it("skips gate for docs domain", () => {
    const policy = resolvePolicy("docs");
    const results = evaluateGates(policy, {});
    const qaGate = results.find((r) => r.gate === "qa");
    const hitlGate = results.find((r) => r.gate === "hitl");
    expect(qaGate?.blocks).toBe(false);
    expect(hitlGate?.blocks).toBe(false);
  });

  it("auto gates do not block even when not run", () => {
    const policy = resolvePolicy("default");
    const results = evaluateGates(policy, { ci: true });
    expect(results.every((r) => !r.blocks)).toBe(true);
  });
});
