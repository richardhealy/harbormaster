import { describe, it, expect } from "vitest";
import {
  bumpVersion,
  inferBumpType,
  tagExists,
  compareVersions,
  latestVersionTag,
} from "../src/release/semver.js";

describe("bumpVersion", () => {
  it("bumps patch", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("bumps minor", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("bumps major", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("throws on invalid semver", () => {
    expect(() => bumpVersion("not-a-version", "patch")).toThrow();
  });
});

describe("inferBumpType", () => {
  it("returns patch for fix commits", () => {
    expect(inferBumpType(["fix", "chore"])).toBe("patch");
  });

  it("returns minor for feat commits", () => {
    expect(inferBumpType(["fix", "feat"])).toBe("minor");
  });

  it("returns major for breaking commits", () => {
    expect(inferBumpType(["feat!", "fix"])).toBe("major");
  });

  it("returns major for 'major' type", () => {
    expect(inferBumpType(["major"])).toBe("major");
  });
});

describe("tagExists", () => {
  const tags = ["v1.0.0", "v1.1.0", "v2.0.0"];

  it("returns true when tag exists", () => {
    expect(tagExists("1.1.0", tags)).toBe(true);
  });

  it("returns false when tag does not exist", () => {
    expect(tagExists("1.2.0", tags)).toBe(false);
  });
});

describe("compareVersions", () => {
  it("returns -1 when a < b", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 0 when a === b", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns 1 when a > b", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
  });
});

describe("latestVersionTag", () => {
  it("returns the latest tag", () => {
    expect(latestVersionTag(["v1.0.0", "v2.0.0", "v1.5.0"])).toBe("2.0.0");
  });

  it("ignores non-semver tags", () => {
    expect(latestVersionTag(["latest", "v1.0.0", "nightly"])).toBe("1.0.0");
  });

  it("returns null for empty list", () => {
    expect(latestVersionTag([])).toBeNull();
  });

  it("returns null when no valid semver tags", () => {
    expect(latestVersionTag(["latest", "nightly"])).toBeNull();
  });
});
