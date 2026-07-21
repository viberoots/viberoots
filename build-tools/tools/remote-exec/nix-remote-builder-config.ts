import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../lib/artifact-nix-policy";
export { remoteCiToolsPathEnv } from "./nix-remote-builder-environment";

export type RemoteBuilderPolicy = "inherit_config" | "force_builders_file";
export type RemoteBuilderSystem = "aarch64-darwin" | "aarch64-linux" | "x86_64-linux";

type ProbeResult = {
  result: "passed" | "denied";
  bounded: true;
  owned: true;
};

export type RemoteBuilderSmokeEvidence = {
  schema: "viberoots.remote-builder-smoke-evidence.v2";
  status: "passed";
  supportedSystem: RemoteBuilderSystem;
  builder: {
    policy: RemoteBuilderPolicy;
    identity: `reviewed:${string}`;
  };
  authorities: {
    registryStorePath: string;
    policyAssertionStorePath: string;
    probeFlakeStorePath: string;
  };
  effectivePolicy: {
    inspection: "builder-reported";
    sandbox: true;
    sandboxFallback: false;
    hostPaths: [];
    multiUser: "daemon";
    substituters: string[];
    publicKeys: string[];
  };
  probes: {
    store: ProbeResult & { result: "passed" };
    ordinaryHostRead: ProbeResult & { result: "denied" };
    ordinaryNetwork: ProbeResult & { result: "denied" };
    fixedOutputCorrectHash: ProbeResult & { result: "passed" };
    fixedOutputWrongHash: ProbeResult & { result: "denied" };
  };
};

export type RemoteBuilderPolicyAssertion = Pick<
  RemoteBuilderSmokeEvidence,
  "supportedSystem" | "builder" | "effectivePolicy"
> & { schema: "viberoots.remote-builder-policy-assertion.v1" };

const SYSTEMS = new Set<RemoteBuilderSystem>(["aarch64-darwin", "aarch64-linux", "x86_64-linux"]);
const POLICIES = new Set<RemoteBuilderPolicy>(["inherit_config", "force_builders_file"]);

export function parseRemoteBuilderSystem(value: unknown): RemoteBuilderSystem {
  const system = String(value || "").trim();
  if (!SYSTEMS.has(system as RemoteBuilderSystem)) {
    throw new Error(`remote builder smoke requires a supported Nix system: ${system || "<empty>"}`);
  }
  return system as RemoteBuilderSystem;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`remote builder smoke requires ${name}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`remote builder smoke has invalid ${name} fields: ${actual.join(", ")}`);
  }
}

function assertProbe(value: unknown, name: string, result: "passed" | "denied"): void {
  const probe = record(value, `probes.${name}`);
  exactKeys(probe, ["bounded", "owned", "result"], `probes.${name}`);
  if (probe.result !== result || probe.bounded !== true || probe.owned !== true) {
    throw new Error(`remote builder smoke requires successful bounded owned probe ${name}`);
  }
}

function immutableStorePath(value: unknown, name: string): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+(?:\/[^/]+)?$/u.test(path)) {
    throw new Error(`remote builder smoke requires immutable ${name}`);
  }
  return path;
}

export function assertRemoteBuilderSmokeEvidence(
  value: unknown,
  opts: {
    policy?: RemoteBuilderPolicy;
    expectedSystem?: RemoteBuilderSystem;
    reviewedBuilderIdentities?: readonly string[];
  } = {},
): asserts value is RemoteBuilderSmokeEvidence {
  const evidence = record(value, "evidence object");
  exactKeys(
    evidence,
    ["authorities", "builder", "effectivePolicy", "probes", "schema", "status", "supportedSystem"],
    "top-level",
  );
  if (
    evidence.schema !== "viberoots.remote-builder-smoke-evidence.v2" ||
    evidence.status !== "passed"
  ) {
    throw new Error("remote builder smoke requires passed v2 evidence");
  }
  if (!SYSTEMS.has(evidence.supportedSystem as RemoteBuilderSystem)) {
    throw new Error("remote builder smoke requires a supported Nix system");
  }
  if (opts.expectedSystem && evidence.supportedSystem !== opts.expectedSystem) {
    throw new Error(
      `remote builder smoke system does not match active execution system: expected=${opts.expectedSystem} actual=${String(evidence.supportedSystem)}`,
    );
  }
  const builder = record(evidence.builder, "builder");
  exactKeys(builder, ["identity", "policy"], "builder");
  if (!POLICIES.has(builder.policy as RemoteBuilderPolicy) || builder.policy !== opts.policy) {
    if (opts.policy) throw new Error("remote builder smoke policy does not match action policy");
    if (!POLICIES.has(builder.policy as RemoteBuilderPolicy)) {
      throw new Error("remote builder smoke requires a remote builder policy");
    }
  }
  const identity = typeof builder.identity === "string" ? builder.identity.trim() : "";
  if (!identity.startsWith("reviewed:") || identity.length === "reviewed:".length) {
    throw new Error("remote builder smoke requires a nonempty reviewed builder identity");
  }
  if (opts.reviewedBuilderIdentities && !opts.reviewedBuilderIdentities.includes(identity)) {
    throw new Error(`remote builder smoke rejects unreviewed builder identity: ${identity}`);
  }
  const authorities = record(evidence.authorities, "authorities");
  exactKeys(
    authorities,
    ["policyAssertionStorePath", "probeFlakeStorePath", "registryStorePath"],
    "authorities",
  );
  immutableStorePath(authorities.registryStorePath, "reviewed-builder registry path");
  immutableStorePath(authorities.policyAssertionStorePath, "builder policy assertion path");
  immutableStorePath(authorities.probeFlakeStorePath, "probe flake path");
  const policy = record(evidence.effectivePolicy, "effectivePolicy");
  exactKeys(
    policy,
    [
      "hostPaths",
      "inspection",
      "multiUser",
      "publicKeys",
      "sandbox",
      "sandboxFallback",
      "substituters",
    ],
    "effectivePolicy",
  );
  if (policy.inspection !== "builder-reported")
    throw new Error("remote builder smoke requires builder-reported policy");
  if (policy.sandbox !== true) throw new Error("remote builder smoke requires sandbox=true");
  if (policy.sandboxFallback !== false)
    throw new Error("remote builder smoke requires sandbox-fallback=false");
  if (!Array.isArray(policy.hostPaths) || policy.hostPaths.length !== 0)
    throw new Error("remote builder smoke rejects host sandbox paths");
  if (policy.multiUser !== "daemon") throw new Error("remote builder smoke requires daemon store");
  if (
    !Array.isArray(policy.substituters) ||
    JSON.stringify(policy.substituters) !== JSON.stringify(REVIEWED_SUBSTITUTERS)
  )
    throw new Error("remote builder smoke rejects unreviewed substituters");
  if (
    !Array.isArray(policy.publicKeys) ||
    JSON.stringify(policy.publicKeys) !== JSON.stringify(REVIEWED_PUBLIC_KEYS)
  )
    throw new Error("remote builder smoke rejects unreviewed public keys");
  const probes = record(evidence.probes, "probes");
  exactKeys(
    probes,
    [
      "fixedOutputCorrectHash",
      "fixedOutputWrongHash",
      "ordinaryHostRead",
      "ordinaryNetwork",
      "store",
    ],
    "probes",
  );
  assertProbe(probes.store, "store", "passed");
  assertProbe(probes.ordinaryHostRead, "ordinaryHostRead", "denied");
  assertProbe(probes.ordinaryNetwork, "ordinaryNetwork", "denied");
  assertProbe(probes.fixedOutputCorrectHash, "fixedOutputCorrectHash", "passed");
  assertProbe(probes.fixedOutputWrongHash, "fixedOutputWrongHash", "denied");
}

export function parseRemoteBuilderSmokeEvidence(
  text: string,
  opts: {
    policy?: RemoteBuilderPolicy;
    expectedSystem?: RemoteBuilderSystem;
    reviewedBuilderIdentities?: readonly string[];
  } = {},
): RemoteBuilderSmokeEvidence {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("remote builder smoke evidence is not valid JSON");
  }
  assertRemoteBuilderSmokeEvidence(value, opts);
  return value;
}

const passed = () => ({ result: "passed", bounded: true, owned: true }) as const;
const denied = () => ({ result: "denied", bounded: true, owned: true }) as const;

export function buildRemoteBuilderSmokeEvidence(
  assertionValue: unknown,
  opts: {
    policy: RemoteBuilderPolicy;
    expectedSystem?: RemoteBuilderSystem;
    reviewedBuilderIdentities: readonly string[];
    authorities: RemoteBuilderSmokeEvidence["authorities"];
  },
): RemoteBuilderSmokeEvidence {
  const assertion = record(assertionValue, "builder policy assertion");
  exactKeys(
    assertion,
    ["builder", "effectivePolicy", "schema", "supportedSystem"],
    "builder policy assertion",
  );
  if (assertion.schema !== "viberoots.remote-builder-policy-assertion.v1") {
    throw new Error("remote builder smoke requires a v1 builder policy assertion");
  }
  const evidence = {
    schema: "viberoots.remote-builder-smoke-evidence.v2",
    status: "passed",
    supportedSystem: assertion.supportedSystem,
    builder: assertion.builder,
    authorities: opts.authorities,
    effectivePolicy: assertion.effectivePolicy,
    probes: {
      store: passed(),
      ordinaryHostRead: denied(),
      ordinaryNetwork: denied(),
      fixedOutputCorrectHash: passed(),
      fixedOutputWrongHash: denied(),
    },
  };
  assertRemoteBuilderSmokeEvidence(evidence, opts);
  return evidence;
}
