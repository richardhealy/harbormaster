import semver from "semver";

export type BumpType = "major" | "minor" | "patch";

/**
 * Bumps a semver string by the given release type.
 * Returns the new version string, or throws if the input is invalid.
 */
export function bumpVersion(current: string, type: BumpType): string {
  const next = semver.inc(current, type);
  if (!next) {
    throw new Error(`Invalid semver version: ${current}`);
  }
  return next;
}

/**
 * Returns the bump type implied by a set of conventional-commit types.
 * A breaking change (!) or 'major' forces a major bump.
 * 'feat' forces a minor bump.
 * Everything else is a patch.
 */
export function inferBumpType(commitTypes: string[]): BumpType {
  if (commitTypes.some((t) => t.includes("!") || t === "major")) return "major";
  if (commitTypes.includes("feat")) return "minor";
  return "patch";
}

/**
 * Returns true if a version tag already exists for the given version.
 * `existingTags` is the list of git tag names.
 */
export function tagExists(version: string, existingTags: string[]): boolean {
  const tagName = `v${version}`;
  return existingTags.includes(tagName);
}

/**
 * Compares two semver strings. Returns -1, 0, or 1.
 */
export function compareVersions(a: string, b: string): number {
  return semver.compare(a, b);
}

/**
 * Returns the latest semver tag from a list of git tag names.
 * Non-semver tags are ignored.
 */
export function latestVersionTag(tags: string[]): string | null {
  const versions = tags
    .map((t) => t.replace(/^v/, ""))
    .filter((t) => semver.valid(t))
    .sort((a, b) => semver.rcompare(a, b));
  return versions[0] ?? null;
}
