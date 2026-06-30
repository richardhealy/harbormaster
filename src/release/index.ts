/**
 * Release lifecycle module — a TypeScript port of the human release process
 * previously implemented as `release.sh` (from the sister project `ggsa-spt`).
 *
 * Covers the mechanics of cutting and shipping releases: semver bumping from
 * the latest git tag, release branch creation, idempotent tagging of main,
 * hotfixes that fan out to every branch that needs them, and syncing develop
 * back up with main after a release.
 *
 * Note: this module only ports the lifecycle mechanics. The original script's
 * manual "resolve conflicts yourself, then continue" merge step is replaced
 * elsewhere in harbormaster (see scheduler/ and integration/) by the
 * conflict-aware scheduler and optimistic merge queue — this module does not
 * implement that replacement itself.
 */
export * from './types'
export * from './semver'
export * from './branch'
export * from './tags'
export * from './hotfix'
export * from './sync'
