declare const nixCachePolicyCapabilityBrand: unique symbol;

export type NixCachePolicyCapability = {
  readonly [nixCachePolicyCapabilityBrand]: never;
};

export type NixCachePolicyCapabilityOutcome =
  | {
      kind: "reviewed";
      config: string;
      policy: "auto" | "strict";
      requiredSubstituters: readonly string[];
      optionalSubstituters: readonly string[];
    }
  | { kind: "off" };

export function nixCachePolicyBindingDigest(
  outcome: Extract<NixCachePolicyCapabilityOutcome, { kind: "reviewed" }>,
): string {
  return createHash("sha256")
    .update(
      [
        "reviewed-cache-roles-v1",
        outcome.policy,
        outcome.requiredSubstituters.join(" "),
        outcome.optionalSubstituters.join(" "),
        outcome.config,
      ].join("\0"),
    )
    .digest("hex");
}

const issuedCapabilities = new WeakMap<object, NixCachePolicyCapabilityOutcome>();
let activeCapability: NixCachePolicyCapability | undefined;

export function activateNixCachePolicyCapabilityAfterCanonicalEntry(
  env: NodeJS.ProcessEnv,
  outcome: NixCachePolicyCapabilityOutcome,
): NixCachePolicyCapability {
  if (env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT !== "1") {
    throw new Error("cannot establish Nix cache policy authority before canonical entry");
  }
  const capability = Object.freeze({}) as NixCachePolicyCapability;
  issuedCapabilities.set(
    capability,
    Object.freeze(
      outcome.kind === "reviewed"
        ? {
            ...outcome,
            requiredSubstituters: Object.freeze([...outcome.requiredSubstituters]),
            optionalSubstituters: Object.freeze([...outcome.optionalSubstituters]),
          }
        : { ...outcome },
    ),
  );
  activeCapability = capability;
  return capability;
}

export function currentNixCachePolicyCapability(): NixCachePolicyCapability {
  if (!activeCapability || !issuedCapabilities.has(activeCapability)) {
    throw new Error(
      "Nix cache policy authority is unavailable: cache health must be reviewed or explicitly off",
    );
  }
  return activeCapability;
}

export function maybeCurrentNixCachePolicyCapability(): NixCachePolicyCapability | undefined {
  return activeCapability && issuedCapabilities.has(activeCapability)
    ? activeCapability
    : undefined;
}

export function outcomeFromNixCachePolicyCapability(
  capability: NixCachePolicyCapability | undefined,
): NixCachePolicyCapabilityOutcome {
  if (!capability || typeof capability !== "object" || !issuedCapabilities.has(capability)) {
    throw new Error("Nix cache policy authority is missing or invalid");
  }
  return issuedCapabilities.get(capability) as NixCachePolicyCapabilityOutcome;
}
import { createHash } from "node:crypto";
