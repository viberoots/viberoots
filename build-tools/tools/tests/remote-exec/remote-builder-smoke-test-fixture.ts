import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";

export const remoteBuilderSmokeEvidence = {
  schema: "viberoots.remote-builder-smoke-evidence.v4",
  status: "passed",
  supportedSystem: "x86_64-linux",
  builder: {
    policy: "inherit_config",
    identity: "reviewed:test-builder",
    endpoint: {
      schema: "viberoots.remote-builder-endpoint.v2",
      protocol: "ssh-ng",
      host: "builder.example.com",
      port: 22,
      user: "nix",
      hostKey: {
        algorithm: "ssh-ed25519",
        publicKey: "AAAAC3NzaC1lZDI1NTE5AAAAIHZs0h63XqwPCOe+Hw1bExE5FU8XeADMOijgI1J0/R9q",
        fingerprint: "SHA256:hKX2WRrp0EaRIfb000oRGYXwjSTqwnV9h8n/vb2P9JA",
      },
    },
  },
  authorities: {
    registryStorePath:
      "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-reviewed-builders/registry.json",
    policyAssertionStorePath: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-builder-policy",
    probeFlakeStorePath: "/nix/store/cccccccccccccccccccccccccccccccc-remote-probe-flake",
  },
  effectivePolicy: {
    inspection: "trusted-builder-daemon-with-live-canaries",
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
