import assert from "node:assert/strict";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";
import type { NixStoreMaterializationManifest } from "../../remote-exec/nix-store-materialize";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";

export const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());

export const manifest: NixStoreMaterializationManifest = {
  schemaVersion: "viberoots.nix-store-materialization.v1",
  sourceRevision: "abc123",
  sourceSnapshot: "/nix/store/source-snapshot",
  flakeLockFingerprint: "sha256-lock",
  substituter: {
    endpointIdentity: REVIEWED_SUBSTITUTERS[0],
    trustedPublicKeys: [REVIEWED_PUBLIC_KEYS[0]],
  },
  tools: {
    nix: artifactToolsRoot,
  },
  storePaths: [
    {
      attr: "remote-worker-tools",
      path: "/nix/store/remote-worker-tools",
      narHash: "sha256-worker",
      expectedOutputIdentity: "remote-worker-tools",
    },
    {
      attr: "test-seed",
      path: "/nix/store/test-seed",
      expectedOutputIdentity: "test-seed",
    },
    {
      attr: "graph-generator-selected",
      path: "/nix/store/selected-output",
      expectedOutputIdentity: "selected-target-output",
    },
  ],
};

export function assertMaterializationRemotePolicy(): void {
  const base = {
    target: "//pkg:t",
    ruleFamily: "go_nix_test",
    labels: ["remote:ready"],
    runFromProjectRoot: true,
    useProjectRelativePaths: true,
    commandInputsDeclared: true,
    nixBuilderPolicy: "inherit_config",
    remoteBuilderSmokePolicy: "inherit_config",
    remoteBuilderSmokeEvidence,
  };
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      targets: [{ ...base, referencedNixStorePaths: ["/nix/store/plain-tool"] }],
    })
      .map((finding) => finding.message)
      .join("\n"),
    /materialization manifest/,
  );
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      targets: [
        {
          ...base,
          materializationManifestDeclared: true,
          materializationManifestPaths: ["/nix/store/plain-tool"],
          referencedNixStorePaths: ["/nix/store/plain-tool"],
        },
      ],
    }),
    [],
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      targets: [
        {
          ...base,
          materializationManifestDeclared: true,
          materializationManifestPaths: ["/nix/store/other-tool"],
          referencedNixStorePaths: ["/nix/store/plain-tool"],
        },
      ],
    })
      .map((finding) => finding.message)
      .join("\n"),
    /missing from materialization manifest/,
  );
}
