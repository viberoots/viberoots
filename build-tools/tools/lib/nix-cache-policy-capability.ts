declare const nixCachePolicyCapabilityBrand: unique symbol;

export type NixCachePolicyCapability = {
  readonly [nixCachePolicyCapabilityBrand]: never;
};

export type NixCachePolicyCapabilityOutcome =
  | { kind: "reviewed"; config: string }
  | { kind: "off" };

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
  issuedCapabilities.set(capability, Object.freeze({ ...outcome }));
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

export function outcomeFromNixCachePolicyCapability(
  capability: NixCachePolicyCapability | undefined,
): NixCachePolicyCapabilityOutcome {
  if (!capability || typeof capability !== "object" || !issuedCapabilities.has(capability)) {
    throw new Error("Nix cache policy authority is missing or invalid");
  }
  return issuedCapabilities.get(capability) as NixCachePolicyCapabilityOutcome;
}
