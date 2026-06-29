import { execSync } from 'child_process';

export interface SemanticConflict {
  type: 'type_error' | 'build_error' | 'test_failure';
  branch: string;
  file?: string;
  message: string;
}

export interface SemanticCheckResult {
  passed: boolean;
  conflicts: SemanticConflict[];
  checkedBranches: string[];
}

function run(cmd: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return { success: false, output: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

export function detectTypeConflicts(
  repoPath: string,
  branch: string,
  tsConfigPath = 'tsconfig.json'
): SemanticConflict[] {
  const { success, output } = run(`npx tsc --noEmit -p ${tsConfigPath} 2>&1`, repoPath);
  if (success) return [];

  return [{
    type: 'type_error',
    branch,
    message: output.trim().slice(0, 2000),
  }];
}

export function detectBuildConflicts(
  repoPath: string,
  branch: string,
  buildCmd = 'npm run build'
): SemanticConflict[] {
  const { success, output } = run(buildCmd, repoPath);
  if (success) return [];

  return [{
    type: 'build_error',
    branch,
    message: output.trim().slice(0, 2000),
  }];
}

export async function checkSemanticConflicts(
  repoPath: string,
  branches: string[]
): Promise<SemanticCheckResult> {
  const conflicts: SemanticConflict[] = [];

  for (const branch of branches) {
    try {
      execSync(`git worktree add /tmp/semantic-check-${branch.replace(/\//g, '-')} ${branch}`, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      const worktreePath = `/tmp/semantic-check-${branch.replace(/\//g, '-')}`;
      conflicts.push(...detectTypeConflicts(worktreePath, branch));
    } catch {
      conflicts.push({
        type: 'build_error',
        branch,
        message: `Could not create worktree for branch ${branch}`,
      });
    } finally {
      try {
        execSync(`git worktree remove --force /tmp/semantic-check-${branch.replace(/\//g, '-')}`, {
          cwd: repoPath,
          stdio: 'pipe',
        });
      } catch (_err) {
        // worktree cleanup is best-effort
      }
    }
  }

  return {
    passed: conflicts.length === 0,
    conflicts,
    checkedBranches: branches,
  };
}
