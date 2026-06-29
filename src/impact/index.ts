import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";

export interface ImpactEstimate {
  paths: string[];
  /** Normalised score 0–1 representing how broadly this change touches the repo */
  breadth: number;
}

/**
 * Estimates the impact surface of a ticket based on a set of changed files.
 *
 * In M0 this is a heuristic: it expands the path list by one directory level
 * to capture likely neighbours. M3 will replace this with a real dependency
 * graph walk via spelunk.
 */
export function estimateImpact(changedPaths: string[]): ImpactEstimate {
  if (changedPaths.length === 0) {
    return { paths: [], breadth: 0 };
  }

  // Expand to parent directories so adjacent files in the same directory
  // are considered part of the impact surface
  const expanded = new Set<string>(changedPaths);
  for (const p of changedPaths) {
    const parts = p.split("/");
    if (parts.length > 1) {
      expanded.add(parts.slice(0, -1).join("/") + "/*");
    }
  }

  const paths = Array.from(expanded).sort();
  // Breadth: normalise against a typical repo size of 100 files
  const breadth = Math.min(1, paths.length / 100);

  return { paths, breadth };
}

/**
 * Walks a directory tree and returns all TypeScript/JavaScript file paths
 * relative to `root`. Used for scope-check comparisons.
 */
export async function listSourceFiles(
  root: string,
  extensions = [".ts", ".tsx", ".js", ".jsx"]
): Promise<string[]> {
  const results: string[] = [];
  const exts = new Set(extensions);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (exts.has(extname(entry.name))) {
        results.push(full.slice(root.length + 1));
      }
    }
  }

  await walk(root);
  return results.sort();
}

/**
 * Parses a simple import graph from TypeScript source files.
 * Returns a map of file → files it imports. Used by M3 semantic analysis.
 * This is a regex-based approximation; M3 will use a proper AST.
 */
export async function buildImportGraph(
  root: string,
  files: string[]
): Promise<Map<string, string[]>> {
  const graph = new Map<string, string[]>();
  const importRe = /from\s+['"]([^'"]+)['"]/g;

  for (const file of files) {
    const content = await readFile(join(root, file), "utf-8").catch(() => "");
    const imports: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(content)) !== null) {
      const spec = match[1]!;
      if (spec.startsWith(".")) {
        imports.push(spec);
      }
    }
    graph.set(file, imports);
  }

  return graph;
}
