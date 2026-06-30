import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  resolveImport,
  extractImports,
  collectFiles,
  buildDependencyGraph,
} from '../../src/impact/graph'

// ─── temp directory fixture ───────────────────────────────────────────────────

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-graph-test-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function write(rel: string, content: string): string {
  const abs = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

// ─── resolveImport ────────────────────────────────────────────────────────────

describe('resolveImport', () => {
  it('returns undefined for external packages', () => {
    const abs = write('src/entry.ts', '')
    expect(resolveImport('lodash', abs)).toBeUndefined()
    expect(resolveImport('@scope/pkg', abs)).toBeUndefined()
  })

  it('resolves a sibling file with .ts extension', () => {
    const from = write('src/foo.ts', '')
    const target = write('src/bar.ts', '')
    const result = resolveImport('./bar', from)
    expect(result).toBe(target)
  })

  it('resolves an index file in a subdirectory', () => {
    const from = write('src/main.ts', '')
    const idx = write('src/utils/index.ts', '')
    const result = resolveImport('./utils', from)
    expect(result).toBe(idx)
  })

  it('returns undefined for an unresolvable specifier', () => {
    const from = write('src/x.ts', '')
    expect(resolveImport('./does-not-exist', from)).toBeUndefined()
  })
})

// ─── extractImports ───────────────────────────────────────────────────────────

describe('extractImports', () => {
  it('extracts a named import', () => {
    const dep = write('lib/helper.ts', '')
    const src = write('lib/consumer.ts', `import { foo } from './helper'`)
    const result = extractImports(src)
    expect(result).toContain(dep)
  })

  it('extracts a default import', () => {
    const dep = write('lib2/thing.ts', '')
    const src = write('lib2/user.ts', `import Thing from './thing'`)
    expect(extractImports(src)).toContain(dep)
  })

  it('extracts a star import', () => {
    const dep = write('lib3/all.ts', '')
    const src = write('lib3/star.ts', `import * as All from './all'`)
    expect(extractImports(src)).toContain(dep)
  })

  it('extracts a bare side-effect import', () => {
    const dep = write('lib4/side.ts', '')
    const src = write('lib4/main.ts', `import './side'`)
    expect(extractImports(src)).toContain(dep)
  })

  it('extracts re-export from', () => {
    const dep = write('lib5/inner.ts', '')
    const src = write('lib5/barrel.ts', `export { X } from './inner'`)
    expect(extractImports(src)).toContain(dep)
  })

  it('skips external packages', () => {
    const src = write('lib6/ext.ts', `import express from 'express'\nimport _ from 'lodash'`)
    const result = extractImports(src)
    expect(result).toHaveLength(0)
  })

  it('returns no duplicates when a file is imported twice', () => {
    const dep = write('lib7/shared.ts', '')
    const src = write(
      'lib7/double.ts',
      `import { a } from './shared'\nimport { b } from './shared'`,
    )
    const result = extractImports(src)
    expect(result.filter(f => f === dep)).toHaveLength(1)
  })

  it('returns empty array for a non-existent file', () => {
    expect(extractImports('/does/not/exist.ts')).toEqual([])
  })
})

// ─── collectFiles ─────────────────────────────────────────────────────────────

describe('collectFiles', () => {
  it('collects .ts files recursively', () => {
    const a = write('collect/a.ts', '')
    const b = write('collect/sub/b.ts', '')
    const files = collectFiles(path.join(tmpDir, 'collect'))
    expect(files).toContain(a)
    expect(files).toContain(b)
  })

  it('skips node_modules', () => {
    write('col2/node_modules/pkg/index.ts', '')
    const a = write('col2/index.ts', '')
    const files = collectFiles(path.join(tmpDir, 'col2'))
    expect(files).toContain(a)
    expect(files.some(f => f.includes('node_modules'))).toBe(false)
  })

  it('does not include non-source files', () => {
    write('col3/readme.md', '')
    write('col3/data.json', '')
    const a = write('col3/main.ts', '')
    const files = collectFiles(path.join(tmpDir, 'col3'))
    expect(files).toContain(a)
    expect(files.some(f => f.endsWith('.md') || f.endsWith('.json'))).toBe(false)
  })
})

// ─── buildDependencyGraph ─────────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  it('builds a graph with correct import and importedBy edges', () => {
    const utils = write('graph1/utils.ts', '')
    const feature = write('graph1/feature.ts', `import { x } from './utils'`)
    const root = path.join(tmpDir, 'graph1')
    const graph = buildDependencyGraph(root)

    expect(graph.has(utils)).toBe(true)
    expect(graph.has(feature)).toBe(true)

    const featureNode = graph.get(feature)!
    expect(featureNode.imports).toContain(utils)

    const utilsNode = graph.get(utils)!
    expect(utilsNode.importedBy).toContain(feature)
  })

  it('handles transitive chain', () => {
    const a = write('graph2/a.ts', '')
    const b = write('graph2/b.ts', `import './a'`)
    const c = write('graph2/c.ts', `import './b'`)
    const root = path.join(tmpDir, 'graph2')
    const graph = buildDependencyGraph(root)

    expect(graph.get(b)!.imports).toContain(a)
    expect(graph.get(c)!.imports).toContain(b)
    expect(graph.get(a)!.importedBy).toContain(b)
    expect(graph.get(b)!.importedBy).toContain(c)
  })

  it('returns an empty graph for an empty directory', () => {
    const emptyDir = path.join(tmpDir, 'graph_empty')
    fs.mkdirSync(emptyDir, { recursive: true })
    expect(buildDependencyGraph(emptyDir).size).toBe(0)
  })
})
