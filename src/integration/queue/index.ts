export type MergeQueueProvider = 'github' | 'mergify';

export interface QueueEntry {
  ticketId: string;
  branch: string;
  headSha: string;
  status: 'queued' | 'rebasing' | 'ci_running' | 'merged' | 'failed';
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MergeQueueAdapter {
  enqueue(branch: string, headSha: string): Promise<void>;
  getStatus(branch: string): Promise<QueueEntry['status']>;
  dequeue(branch: string): Promise<void>;
}

export interface GitHubMergeQueueConfig {
  owner: string;
  repo: string;
  installationToken: string;
}

export class GitHubMergeQueueAdapter implements MergeQueueAdapter {
  constructor(private readonly config: GitHubMergeQueueConfig) {}

  async enqueue(branch: string, _headSha: string): Promise<void> {
    const response = await fetch(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/pulls`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.installationToken}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to check PR status for branch ${branch}: ${response.status}`);
    }
  }

  async getStatus(branch: string): Promise<QueueEntry['status']> {
    const response = await fetch(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/mergequeue/entries`,
      {
        headers: {
          Authorization: `Bearer ${this.config.installationToken}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );

    if (!response.ok) return 'failed';

    const entries = await response.json() as Array<{ head_ref?: string; state?: string }>;
    const entry = entries.find((e) => e.head_ref === branch);
    if (!entry) return 'failed';

    switch (entry.state) {
      case 'QUEUED': return 'queued';
      case 'AWAITING_CHECKS': return 'ci_running';
      case 'MERGED': return 'merged';
      default: return 'failed';
    }
  }

  async dequeue(_branch: string): Promise<void> {
  }
}

export function createMergeQueueAdapter(
  provider: MergeQueueProvider,
  config: Record<string, string>
): MergeQueueAdapter {
  if (provider === 'github') {
    return new GitHubMergeQueueAdapter({
      owner: config['owner'] ?? '',
      repo: config['repo'] ?? '',
      installationToken: config['installationToken'] ?? '',
    });
  }

  throw new Error(`Unsupported merge queue provider: ${provider}`);
}
