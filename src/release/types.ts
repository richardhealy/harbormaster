export type SemverBump = 'major' | 'minor' | 'patch';

export interface ReleaseConfig {
  mainBranch: string;
  developBranch: string;
  releaseBranchPrefix: string;
  hotfixBranchPrefix: string;
  tagPrefix: string;
}

export interface ReleaseContext {
  config: ReleaseConfig;
  git: GitOps;
}

export interface GitOps {
  currentBranch(): Promise<string>;
  tags(): Promise<string[]>;
  branches(): Promise<string[]>;
  latestTag(): Promise<string | null>;
  createBranch(name: string, from: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  merge(branch: string, opts?: MergeOpts): Promise<void>;
  tag(name: string, message?: string): Promise<void>;
  push(branch: string, opts?: PushOpts): Promise<void>;
  pushTag(tag: string): Promise<void>;
  log(from: string, to?: string): Promise<Commit[]>;
  hasUncommittedChanges(): Promise<boolean>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  commit(message: string): Promise<void>;
  tagExists(tag: string): Promise<boolean>;
  branchExists(branch: string): Promise<boolean>;
}

export interface MergeOpts {
  noFF?: boolean;
  strategy?: string;
  message?: string;
}

export interface PushOpts {
  force?: boolean;
  setUpstream?: boolean;
}

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  date: Date;
}

export interface ReleaseInfo {
  version: string;
  branch: string;
  tag: string;
  isNew: boolean;
}

export interface HotfixInfo {
  version: string;
  branch: string;
  basedOn: string;
}

export type ConventionalType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'test'
  | 'chore'
  | 'perf'
  | 'ci'
  | 'build'
  | 'revert';

export interface FeatureBranchOpts {
  type: ConventionalType;
  ticketId: string;
  description: string;
  base?: string;
}
