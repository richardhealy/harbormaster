import { describe, it, expect } from "vitest";
import { estimateImpact } from "../src/impact/index.js";

describe("estimateImpact", () => {
  it("returns empty for no changed paths", () => {
    const result = estimateImpact([]);
    expect(result.paths).toHaveLength(0);
    expect(result.breadth).toBe(0);
  });

  it("expands to parent directory", () => {
    const result = estimateImpact(["src/api/router.ts"]);
    expect(result.paths).toContain("src/api/*");
    expect(result.paths).toContain("src/api/router.ts");
  });

  it("returns breadth proportional to path count", () => {
    const paths = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    const result = estimateImpact(paths);
    expect(result.breadth).toBeGreaterThan(0);
    expect(result.breadth).toBeLessThanOrEqual(1);
  });

  it("caps breadth at 1 for very large change sets", () => {
    const paths = Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`);
    const result = estimateImpact(paths);
    expect(result.breadth).toBe(1);
  });

  it("deduplicates expanded paths", () => {
    const result = estimateImpact(["src/a.ts", "src/b.ts"]);
    const wildcards = result.paths.filter((p) => p.endsWith("/*"));
    expect(wildcards).toHaveLength(1); // both share "src/*"
  });
});
