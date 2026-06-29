import type { Octokit } from "@octokit/core";

export interface CheckRunParams {
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";
  output?: { title: string; summary: string };
}

/**
 * Creates or updates a GitHub check run for a given commit SHA.
 * Used to report gate results back to the PR.
 */
export async function upsertCheckRun(
  octokit: Octokit,
  params: CheckRunParams
): Promise<number> {
  const response = await octokit.request(
    "POST /repos/{owner}/{repo}/check-runs",
    {
      owner: params.owner,
      repo: params.repo,
      name: params.name,
      head_sha: params.headSha,
      status: params.status,
      conclusion: params.conclusion,
      output: params.output,
    }
  );
  return (response.data as { id: number }).id;
}

/**
 * Enforces the harbormaster policy: no direct pushes to main.
 * Called from the push webhook handler. Returns true if the push should be blocked.
 */
export function shouldBlockDirectMainPush(payload: {
  ref: string;
  sender?: { type?: string };
}): boolean {
  if (payload.ref !== "refs/heads/main") return false;
  // Allow GitHub Actions and Apps (the merge queue) to push to main
  if (payload.sender?.type === "Bot") return false;
  return true;
}
