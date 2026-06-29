# harbormaster

A coordination layer for a fleet of AI coding agents on one repository.

**The problem it solves:** Safe concurrency for autonomous coding agents — at the planning and integration layers rather than by locking the editor.

## How it works

Three layers, in order of importance:

1. **Schedule against impact** — estimate each ticket's impact surface and run non-overlapping tickets in parallel; sequence overlapping ones; merge tickets that clearly hit the same code into a single job.
2. **Integrate optimistically through a merge queue** — every agent works in its own worktree; integration serializes via rebase + CI; a real collision shows up as a failed rebase or red CI and the losing agent re-runs.
3. **Advisory leases for hotspots only** — a small declared set (migrations, giant shared files) gets an advisory lock; everything else stays lock-free.

## Stack

- **Runtime:** Node.js / TypeScript
- **Database:** PostgreSQL (state + immutable audit log)
- **GitHub integration:** GitHub App (webhooks, merge queue)
- **Issue tracking:** Linear
- **Testing:** Vitest

## Getting started

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, GITHUB_*, LINEAR_API_KEY
npm run db:migrate
npm run build
npm start
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_PRIVATE_KEY` | GitHub App RSA private key (PEM, `\n`-escaped) |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret |
| `LINEAR_API_KEY` | Linear API key (optional) |
| `MERGE_QUEUE_PROVIDER` | `github` or `mergify` (default: `github`) |
| `PORT` | HTTP port (default: `3000`) |

## Development

```bash
npm test          # run the full test suite (Vitest)
npm run typecheck # TypeScript check
npm run lint      # ESLint
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) (coming soon).

## Current status

M0 (Scaffold) complete — TypeScript project, Postgres schema, GitHub App boilerplate, release lifecycle ported from `release.sh`, and full test suite. See [PROGRESS.md](PROGRESS.md).
