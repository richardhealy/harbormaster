export interface PushEvent {
  ref: string
  before: string
  after: string
  repository: { full_name: string; default_branch: string }
  pusher: { name: string }
}

export interface PullRequestEvent {
  action: string
  pull_request: {
    number: number
    title: string
    head: { ref: string; sha: string }
    base: { ref: string }
    state: string
  }
  repository: { full_name: string }
}

export interface CheckRunEvent {
  action: string
  check_run: {
    id: number
    name: string
    conclusion: string | null
    status: string
    head_sha: string
  }
  repository: { full_name: string }
}

export type GitHubEvent = PushEvent | PullRequestEvent | CheckRunEvent
