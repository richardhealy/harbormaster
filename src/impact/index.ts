import { execSync } from 'child_process';

export interface ImpactSurface {
  files: string[];
  modules: string[];
  estimatedRisk: 'low' | 'medium' | 'high';
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export function estimateImpactFromDiff(
  repoPath: string,
  branch: string,
  baseBranch: string
): ImpactSurface {
  let diffOutput = '';
  try {
    diffOutput = execSync(
      `git diff ${baseBranch}...${branch} --name-only`,
      { cwd: repoPath, encoding: 'utf8' }
    ).trim();
  } catch {
    return { files: [], modules: [], estimatedRisk: 'low' };
  }

  const files = diffOutput ? diffOutput.split('\n').filter(Boolean) : [];
  const modules = extractModules(files);
  const estimatedRisk = estimateRisk(files, modules);

  return { files, modules, estimatedRisk };
}

function extractModules(files: string[]): string[] {
  const modules = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    if (parts.length >= 2) {
      modules.add(`${parts[0]}/${parts[1]}`);
    } else if (parts.length === 1) {
      modules.add(parts[0]!);
    }
  }
  return [...modules];
}

function estimateRisk(files: string[], modules: string[]): 'low' | 'medium' | 'high' {
  const HIGH_RISK_PATTERNS = [
    /migrations?\//i,
    /schema/i,
    /database/i,
    /auth/i,
    /security/i,
    /config/i,
  ];

  const MEDIUM_RISK_PATTERNS = [
    /api\//i,
    /routes?\//i,
    /models?\//i,
    /services?\//i,
  ];

  const allPaths = [...files, ...modules];

  if (allPaths.some((p) => HIGH_RISK_PATTERNS.some((re) => re.test(p)))) {
    return 'high';
  }

  if (allPaths.some((p) => MEDIUM_RISK_PATTERNS.some((re) => re.test(p))) || files.length > 20) {
    return 'medium';
  }

  return 'low';
}

export function buildDependencyGraph(
  repoPath: string,
  files: string[]
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;

    let content = '';
    try {
      content = execSync(`cat ${repoPath}/${file}`, { encoding: 'utf8' });
    } catch {
      continue;
    }

    const importRegex = /(?:import|require)\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const imported = match[1];
      if (imported && (imported.startsWith('./') || imported.startsWith('../'))) {
        edges.push({ from: file, to: imported });
      }
    }
  }

  return edges;
}
