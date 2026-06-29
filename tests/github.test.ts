import { describe, it, expect } from "vitest";
import { shouldBlockDirectMainPush } from "../src/integrations/github/checks.js";

describe("shouldBlockDirectMainPush", () => {
  it("blocks a human push to main", () => {
    expect(
      shouldBlockDirectMainPush({
        ref: "refs/heads/main",
        sender: { type: "User" },
      })
    ).toBe(true);
  });

  it("allows a bot push to main (merge queue)", () => {
    expect(
      shouldBlockDirectMainPush({
        ref: "refs/heads/main",
        sender: { type: "Bot" },
      })
    ).toBe(false);
  });

  it("does not block pushes to other branches", () => {
    expect(
      shouldBlockDirectMainPush({
        ref: "refs/heads/feature/my-feature",
        sender: { type: "User" },
      })
    ).toBe(false);
  });

  it("blocks when sender is undefined", () => {
    expect(shouldBlockDirectMainPush({ ref: "refs/heads/main" })).toBe(true);
  });
});
