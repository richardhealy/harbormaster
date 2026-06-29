import { describe, it, expect } from "vitest";
import { overlapScore, buildDispatchPlans } from "../src/scheduler/planner.js";
import type { TicketRef } from "../src/scheduler/types.js";

describe("overlapScore", () => {
  it("returns 0 for disjoint paths", () => {
    expect(overlapScore(["src/a.ts"], ["src/b.ts"])).toBe(0);
  });

  it("returns 1 for identical paths", () => {
    const paths = ["src/a.ts", "src/b.ts"];
    expect(overlapScore(paths, [...paths])).toBe(1);
  });

  it("returns partial overlap", () => {
    const score = overlapScore(["src/a.ts", "src/b.ts"], ["src/b.ts", "src/c.ts"]);
    // intersection = {b.ts}, union = {a.ts, b.ts, c.ts} → 1/3
    expect(score).toBeCloseTo(1 / 3);
  });

  it("returns 0 for empty arrays", () => {
    expect(overlapScore([], ["src/a.ts"])).toBe(0);
    expect(overlapScore(["src/a.ts"], [])).toBe(0);
  });
});

describe("buildDispatchPlans", () => {
  const makeTicket = (id: string, paths: string[], priority = 0): TicketRef => ({
    id,
    linearId: `ENG-${id}`,
    title: `Ticket ${id}`,
    impactPaths: paths,
    priority,
  });

  it("returns empty for empty input", () => {
    const result = buildDispatchPlans([]);
    expect(result.plans).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });

  it("returns single parallel plan for one ticket", () => {
    const result = buildDispatchPlans([makeTicket("1", ["src/a.ts"])]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]!.action).toBe("parallel");
    expect(result.plans[0]!.ticketIds).toEqual(["1"]);
  });

  it("schedules non-overlapping tickets in parallel", () => {
    const t1 = makeTicket("1", ["src/a.ts"]);
    const t2 = makeTicket("2", ["src/b.ts"]);
    const result = buildDispatchPlans([t1, t2]);
    const actions = result.plans.map((p) => p.action);
    expect(actions).not.toContain("sequence");
    expect(actions).not.toContain("merge");
    expect(result.plans.every((p) => p.action === "parallel")).toBe(true);
  });

  it("sequences tickets with partial overlap", () => {
    // overlap: src/shared.ts appears in both → score = 1/3 ≈ 0.33 → sequence
    const t1 = makeTicket("1", ["src/a.ts", "src/shared.ts"]);
    const t2 = makeTicket("2", ["src/b.ts", "src/shared.ts"]);
    const result = buildDispatchPlans([t1, t2]);
    const sequenced = result.plans.filter((p) => p.action === "sequence");
    expect(sequenced).toHaveLength(1);
    expect(sequenced[0]!.ticketIds).toContain("1");
    expect(sequenced[0]!.ticketIds).toContain("2");
  });

  it("merges tickets with very high overlap", () => {
    // Same 3 paths → overlap = 1.0 → merge
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const t1 = makeTicket("1", paths);
    const t2 = makeTicket("2", paths);
    const result = buildDispatchPlans([t1, t2]);
    const merged = result.plans.filter((p) => p.action === "merge");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ticketIds).toContain("1");
    expect(merged[0]!.ticketIds).toContain("2");
  });

  it("headline test: two overlapping tickets are NOT both in parallel plans", () => {
    // This is the core invariant from the spec quality checklist.
    const shared = ["src/api.ts", "src/router.ts", "src/types.ts"];
    const t1 = makeTicket("1", shared);
    const t2 = makeTicket("2", shared);
    const result = buildDispatchPlans([t1, t2]);

    const parallelPlansWithBoth = result.plans.filter(
      (p) =>
        p.action === "parallel" &&
        p.ticketIds.includes("1") &&
        p.ticketIds.includes("2")
    );
    expect(parallelPlansWithBoth).toHaveLength(0);
  });
});
