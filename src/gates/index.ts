export type GatePolicy = "auto" | "required" | "skip";

export interface DomainPolicy {
  scope: GatePolicy;
  ci: GatePolicy;
  qa: GatePolicy;
  hitl: GatePolicy;
}

/**
 * Default per-domain gate policies.
 *
 * high-risk domains (migrations, shared-contracts) require a human sign-off.
 * low-risk domains (docs, tests) auto-merge on green CI.
 * The default domain sits in between.
 */
export const DEFAULT_POLICIES: Record<string, DomainPolicy> = {
  default: { scope: "auto", ci: "required", qa: "auto", hitl: "auto" },
  migration: { scope: "required", ci: "required", qa: "required", hitl: "required" },
  "shared-contract": { scope: "required", ci: "required", qa: "required", hitl: "required" },
  docs: { scope: "auto", ci: "auto", qa: "skip", hitl: "skip" },
  tests: { scope: "auto", ci: "required", qa: "skip", hitl: "skip" },
};

/**
 * Resolves the gate policy for a given domain.
 * Falls back to the default policy if the domain is not explicitly configured.
 */
export function resolvePolicy(
  domain: string,
  overrides?: Partial<Record<string, DomainPolicy>>
): DomainPolicy {
  const policies = { ...DEFAULT_POLICIES, ...overrides };
  return policies[domain] ?? policies["default"]!;
}

export interface GateCheckResult {
  gate: "scope" | "ci" | "qa" | "hitl";
  policy: GatePolicy;
  /** true if this gate must block the merge */
  blocks: boolean;
  reason?: string;
}

/**
 * Evaluates which gates will block the merge given the domain policy and
 * the outcomes of each gate check.
 *
 * `gateResults` maps gate name → true (passed) | false (failed).
 * Returns one result per gate.
 */
export function evaluateGates(
  policy: DomainPolicy,
  gateResults: Partial<Record<"scope" | "ci" | "qa" | "hitl", boolean>>
): GateCheckResult[] {
  const gates = ["scope", "ci", "qa", "hitl"] as const;
  return gates.map((gate) => {
    const gatePolicy = policy[gate];
    const passed = gateResults[gate];

    if (gatePolicy === "skip") {
      return { gate, policy: gatePolicy, blocks: false };
    }

    if (gatePolicy === "required" && passed === false) {
      return {
        gate,
        policy: gatePolicy,
        blocks: true,
        reason: `${gate} gate required and failed`,
      };
    }

    if (gatePolicy === "required" && passed === undefined) {
      return {
        gate,
        policy: gatePolicy,
        blocks: true,
        reason: `${gate} gate required but not yet run`,
      };
    }

    return { gate, policy: gatePolicy, blocks: false };
  });
}
