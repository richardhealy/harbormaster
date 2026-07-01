# Documentation index

Start with the top-level [README](../README.md) for a project overview and
quickstart. These docs go deeper, each for a different job:

| Doc | Read this when you want to... |
|---|---|
| [how-to.md](./how-to.md) | Do a specific task right now — run the scheduler demo, take a hotspot lease, run a gate, cut a release. Copy-pasteable, verified CLI recipes. |
| [api.md](./api.md) | Look up the exact request/response shape of a command — every field, every error case, for both the CLI and MCP surfaces. |
| [architecture.md](./architecture.md) | Understand how the pieces fit together — component map, data/control flow, the design trade-offs, and where each part of `spec.md` lives in the code. |
| [integration.md](./integration.md) | Stand harbormaster up and wire it into your own system — Postgres setup, GitHub App, Linear, and driving it as an agent (CLI vs. MCP vs. embedded). |

## Reading order

- **New to the project?** [Architecture](./architecture.md) first for the
  shape of the system, then [how-to.md](./how-to.md) to see it run.
- **Integrating an agent against harbormaster?** [Integration guide](./integration.md)
  to stand it up, [api.md](./api.md) as the reference while you build against
  it.
- **Just need to run one command?** [how-to.md](./how-to.md) — find the
  matching recipe, copy the command.
