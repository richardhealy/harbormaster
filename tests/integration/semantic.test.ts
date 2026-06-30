import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SemanticConflictDetector } from '../../src/integration/semantic'
import type {
  InFlightBranch,
  MergeViewFactory,
  TypecheckResult,
  TypecheckRunner,
} from '../../src/integration/semantic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function branch(dispatchId: string, extra: Partial<InFlightBranch> = {}): InFlightBranch {
  return {
    dispatchId,
    branch: `feat/${dispatchId}`,
    worktreePath: `/wt/${dispatchId}`,
    ...extra,
  }
}

function okResult(errors: string[] = []): TypecheckResult {
  return { clean: errors.length === 0, errors, output: errors.join('\n') }
}

/** Runner that returns the provided map of dir→result, falling back to a clean result */
function makeRunner(
  responses: Map<string, TypecheckResult> = new Map(),
  fallback: TypecheckResult = okResult(),
): TypecheckRunner {
  return vi.fn().mockImplementation((dir: string) =>
    Promise.resolve(responses.get(dir) ?? fallback),
  )
}

const MERGE_DIR = '/tmp/merge-1'

function makeFactory(mergeDir = MERGE_DIR): MergeViewFactory {
  return {
    create: vi.fn().mockResolvedValue(mergeDir),
    cleanup: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// checkPair
// ---------------------------------------------------------------------------

describe('SemanticConflictDetector.checkPair', () => {
  let factory: MergeViewFactory

  beforeEach(() => {
    factory = makeFactory()
  })

  it('returns "clean" when the merged view has no errors', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('clean')
    expect(result.newErrors).toHaveLength(0)
  })

  it('sets dispatchIdA and dispatchIdB on the result', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkPair(branch('disp-1'), branch('disp-2'))

    expect(result.dispatchIdA).toBe('disp-1')
    expect(result.dispatchIdB).toBe('disp-2')
  })

  it('returns "conflict" when the merged view introduces a new error', async () => {
    const newError = "src/api.ts(10,3): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."
    const runner = makeRunner(
      new Map([
        ['/wt/A', okResult()],
        ['/wt/B', okResult()],
        [MERGE_DIR, okResult([newError])],
      ]),
    )
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('conflict')
    expect(result.newErrors).toEqual([newError])
  })

  it('returns "clean" when merged errors all pre-exist in branch A', async () => {
    const preExisting = "src/foo.ts(1,5): error TS2345: pre-existing in A"
    const runner = makeRunner(
      new Map([
        ['/wt/A', okResult([preExisting])],
        ['/wt/B', okResult()],
        [MERGE_DIR, okResult([preExisting])],
      ]),
    )
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('clean')
    expect(result.newErrors).toHaveLength(0)
  })

  it('returns "clean" when merged errors all pre-exist in branch B', async () => {
    const preExisting = "src/bar.ts(3,2): error TS2322: pre-existing in B"
    const runner = makeRunner(
      new Map([
        ['/wt/A', okResult()],
        ['/wt/B', okResult([preExisting])],
        [MERGE_DIR, okResult([preExisting])],
      ]),
    )
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('clean')
    expect(result.newErrors).toHaveLength(0)
  })

  it('filters pre-existing errors and only reports truly new ones', async () => {
    const preExisting = "src/a.ts(1,1): error TS2300: pre-existing"
    const newError = "src/b.ts(5,3): error TS2345: signature mismatch after merge"
    const runner = makeRunner(
      new Map([
        ['/wt/A', okResult([preExisting])],
        ['/wt/B', okResult()],
        [MERGE_DIR, okResult([preExisting, newError])],
      ]),
    )
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('conflict')
    expect(result.newErrors).toEqual([newError])
  })

  it('returns "error" outcome when mergeViewFactory.create throws', async () => {
    const badFactory: MergeViewFactory = {
      create: vi.fn().mockRejectedValue(new Error('disk full')),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }
    const detector = new SemanticConflictDetector(makeRunner(), badFactory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('error')
    expect(result.message).toContain('disk full')
    expect(result.newErrors).toHaveLength(0)
  })

  it('returns "error" outcome when typecheckRunner throws', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('tsc not found'))
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkPair(branch('A'), branch('B'))

    expect(result.outcome).toBe('error')
    expect(result.message).toContain('tsc not found')
  })

  it('calls cleanup even when typechecking the merged dir throws', async () => {
    const crashFactory: MergeViewFactory = {
      create: vi.fn().mockResolvedValue(MERGE_DIR),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }
    const runner = vi.fn()
      .mockResolvedValueOnce(okResult()) // branch A
      .mockResolvedValueOnce(okResult()) // branch B
      .mockRejectedValueOnce(new Error('tsc crash')) // merged dir

    const detector = new SemanticConflictDetector(runner, crashFactory)

    await detector.checkPair(branch('A'), branch('B'))

    expect(crashFactory.cleanup).toHaveBeenCalledWith(MERGE_DIR)
  })

  it('does NOT call cleanup when mergeViewFactory.create fails', async () => {
    const badFactory: MergeViewFactory = {
      create: vi.fn().mockRejectedValue(new Error('create failed')),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }
    const detector = new SemanticConflictDetector(makeRunner(), badFactory)

    await detector.checkPair(branch('A'), branch('B'))

    expect(badFactory.cleanup).not.toHaveBeenCalled()
  })

  it('calls typecheckRunner with branch A and B worktree paths', async () => {
    const runner = makeRunner()
    const detector = new SemanticConflictDetector(runner, factory)

    await detector.checkPair(branch('dispatch-1'), branch('dispatch-2'))

    expect(runner).toHaveBeenCalledWith('/wt/dispatch-1')
    expect(runner).toHaveBeenCalledWith('/wt/dispatch-2')
  })

  it('calls typecheckRunner with the merged dir path', async () => {
    const customMergeDir = '/tmp/custom-merge-dir'
    const customFactory: MergeViewFactory = {
      create: vi.fn().mockResolvedValue(customMergeDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }
    const runner = makeRunner()
    const detector = new SemanticConflictDetector(runner, customFactory)

    await detector.checkPair(branch('A'), branch('B'))

    expect(runner).toHaveBeenCalledWith(customMergeDir)
  })

  it('calls mergeViewFactory.create with the correct worktree paths (A first, B second)', async () => {
    const runner = makeRunner()
    const detector = new SemanticConflictDetector(runner, factory)

    await detector.checkPair(branch('disp-A'), branch('disp-B'))

    expect(factory.create).toHaveBeenCalledWith('/wt/disp-A', '/wt/disp-B')
  })

  it('calls mergeViewFactory.cleanup with the merge dir after typechecking', async () => {
    const runner = makeRunner()
    const detector = new SemanticConflictDetector(runner, factory)

    await detector.checkPair(branch('A'), branch('B'))

    expect(factory.cleanup).toHaveBeenCalledWith(MERGE_DIR)
  })

  it('typechecks A and B before creating the merge view', async () => {
    const callOrder: string[] = []
    const sequentialRunner: TypecheckRunner = (dir) => {
      callOrder.push(dir)
      return Promise.resolve(okResult())
    }
    const trackingFactory: MergeViewFactory = {
      create: vi.fn().mockImplementation(() => {
        callOrder.push('create')
        return Promise.resolve(MERGE_DIR)
      }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }
    const detector = new SemanticConflictDetector(sequentialRunner, trackingFactory)

    await detector.checkPair(branch('A'), branch('B'))

    const createIndex = callOrder.indexOf('create')
    expect(createIndex).toBeGreaterThan(0)
    expect(callOrder.slice(0, createIndex)).toContain('/wt/A')
    expect(callOrder.slice(0, createIndex)).toContain('/wt/B')
  })
})

// ---------------------------------------------------------------------------
// checkAll
// ---------------------------------------------------------------------------

describe('SemanticConflictDetector.checkAll', () => {
  let factory: MergeViewFactory

  beforeEach(() => {
    factory = makeFactory()
  })

  it('returns an empty clean result for zero branches', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([])

    expect(result.checkedPairs).toBe(0)
    expect(result.allPairs).toHaveLength(0)
    expect(result.conflicts).toHaveLength(0)
    expect(result.clean).toBe(true)
  })

  it('returns an empty clean result for a single branch', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([branch('A')])

    expect(result.checkedPairs).toBe(0)
    expect(result.clean).toBe(true)
  })

  it('checks exactly one pair for two branches', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([branch('A'), branch('B')])

    expect(result.checkedPairs).toBe(1)
    expect(result.allPairs).toHaveLength(1)
  })

  it('checks three pairs for three branches (n*(n-1)/2 = 3)', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([branch('A'), branch('B'), branch('C')])

    expect(result.checkedPairs).toBe(3)
  })

  it('checks six pairs for four branches', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([
      branch('A'),
      branch('B'),
      branch('C'),
      branch('D'),
    ])

    expect(result.checkedPairs).toBe(6)
  })

  it('returns clean: true when no pair produces new errors', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([branch('A'), branch('B')])

    expect(result.clean).toBe(true)
    expect(result.conflicts).toHaveLength(0)
  })

  it('returns clean: false and populates conflicts when a pair conflicts', async () => {
    const conflictError = "src/api.ts(1,1): error TS2345: cross-branch conflict"
    const runner = makeRunner(new Map([[MERGE_DIR, okResult([conflictError])]]))
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkAll([branch('A'), branch('B')])

    expect(result.clean).toBe(false)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].outcome).toBe('conflict')
    expect(result.conflicts[0].newErrors).toContain(conflictError)
  })

  it('populates the conflicting pair with the correct dispatch IDs', async () => {
    const runner = makeRunner(
      new Map([[MERGE_DIR, okResult(["src/x.ts(1,1): error TS9999: semantic break"])]]),
    )
    const detector = new SemanticConflictDetector(runner, factory)

    const result = await detector.checkAll([branch('disp-1'), branch('disp-2')])

    expect(result.conflicts[0].dispatchIdA).toBe('disp-1')
    expect(result.conflicts[0].dispatchIdB).toBe('disp-2')
  })

  it('allPairs contains entries for every unique pair in input order', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([branch('A'), branch('B'), branch('C')])

    const pairs = result.allPairs.map(r => [r.dispatchIdA, r.dispatchIdB])
    expect(pairs).toContainEqual(['A', 'B'])
    expect(pairs).toContainEqual(['A', 'C'])
    expect(pairs).toContainEqual(['B', 'C'])
  })

  it('allPairs length equals checkedPairs', async () => {
    const detector = new SemanticConflictDetector(makeRunner(), factory)

    const result = await detector.checkAll([branch('A'), branch('B'), branch('C')])

    expect(result.allPairs).toHaveLength(result.checkedPairs)
  })
})
