import * as fs from 'fs'
import * as path from 'path'
import type { DependencyGraph } from './types'

/** Local import specifiers resolved to absolute paths; package imports ignored */
const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g
// Bare side-effect imports: import './styles.css' or import './setup'
const IMPORT_BARE_RE = /\bimport\s+['"]([^'"]+)['"]/g
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache'])

/**
 * Resolves a relative import specifier from a source file to an absolute path.
 * Returns `undefined` for external package imports (not starting with `.` or `/`).
 */
export function resolveImport(
  specifier: string,
  fromFile: string,
): string | undefined {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined

  const fromDir = path.dirname(fromFile)
  const base = path.resolve(fromDir, specifier)

  for (const ext of SOURCE_EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const idx = path.join(base, `index${ext}`)
    if (fs.existsSync(idx)) return idx
  }
  if (fs.existsSync(base)) return base
  return undefined
}

/**
 * Returns absolute paths of all local files imported by the given file.
 * External packages and unresolvable specifiers are silently skipped.
 */
export function extractImports(filePath: string): string[] {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const specifiers: string[] = []
  FROM_RE.lastIndex = 0
  IMPORT_BARE_RE.lastIndex = 0
  REQUIRE_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = FROM_RE.exec(content)) !== null) specifiers.push(m[1])
  while ((m = IMPORT_BARE_RE.exec(content)) !== null) specifiers.push(m[1])
  while ((m = REQUIRE_RE.exec(content)) !== null) specifiers.push(m[1])

  const resolved: string[] = []
  for (const s of specifiers) {
    const r = resolveImport(s, filePath)
    if (r && !resolved.includes(r)) resolved.push(r)
  }
  return resolved
}

/**
 * Recursively collects all TypeScript/JavaScript source files under `root`,
 * skipping common non-source directories.
 */
export function collectFiles(root: string): string[] {
  const results: string[] = []
  function walk(dir: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (SOURCE_EXTENSIONS.some(ext => e.name.endsWith(ext))) {
        results.push(full)
      }
    }
  }
  walk(root)
  return results
}

/**
 * Builds a file-level dependency graph for all source files under `root`.
 *
 * Edges are local `import`/`require` references resolved to absolute paths.
 * External packages are not represented in the graph.
 */
export function buildDependencyGraph(root: string): DependencyGraph {
  const files = collectFiles(root)
  const graph: DependencyGraph = new Map()

  for (const f of files) {
    if (!graph.has(f)) graph.set(f, { path: f, imports: [], importedBy: [] })
  }

  for (const f of files) {
    const node = graph.get(f)!
    for (const dep of extractImports(f)) {
      if (!graph.has(dep)) graph.set(dep, { path: dep, imports: [], importedBy: [] })
      if (!node.imports.includes(dep)) node.imports.push(dep)
      const depNode = graph.get(dep)!
      if (!depNode.importedBy.includes(f)) depNode.importedBy.push(f)
    }
  }

  return graph
}
