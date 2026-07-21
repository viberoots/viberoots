import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";

export const remoteBuilderSmokeEvidence = {
  schema: "viberoots.remote-builder-smoke-evidence.v2",
  status: "passed",
  supportedSystem: "x86_64-linux",
  builder: { policy: "inherit_config", identity: "reviewed:test-builder" },
  authorities: {
    registryStorePath:
      "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-reviewed-builders/registry.json",
    policyAssertionStorePath: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-builder-policy",
    probeFlakeStorePath: "/nix/store/cccccccccccccccccccccccccccccccc-remote-probe-flake",
  },
  effectivePolicy: {
    inspection: "builder-reported",
    sandbox: true,
    sandboxFallback: false,
    hostPaths: [],
    multiUser: "daemon",
    substituters: [...REVIEWED_SUBSTITUTERS],
    publicKeys: [...REVIEWED_PUBLIC_KEYS],
  },
  probes: {
    store: { result: "passed", bounded: true, owned: true },
    ordinaryHostRead: { result: "denied", bounded: true, owned: true },
    ordinaryNetwork: { result: "denied", bounded: true, owned: true },
    fixedOutputCorrectHash: { result: "passed", bounded: true, owned: true },
    fixedOutputWrongHash: { result: "denied", bounded: true, owned: true },
  },
};
