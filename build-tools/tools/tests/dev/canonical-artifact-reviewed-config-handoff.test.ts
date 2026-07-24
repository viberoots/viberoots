#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  canonicalArtifactReentryEnvironment,
  isCanonicalArtifactEntrypointEnvironment,
} from "../../dev/canonical-artifact-entrypoint";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";

const fixture = path.resolve(
  "viberoots/build-tools/tools/tests/dev/canonical-artifact-reviewed-config-handoff.fixture.ts",
);
const zxInit = path.resolve("viberoots/build-tools/tools/dev/zx-init.mjs");
const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
const toolsRoot = canonicalArtifactToolsRoot(
  process.cwd(),
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);
const canonicalBash = path.join(toolsRoot, "bin", "bash");
const ingressScript = path.resolve("viberoots/build-tools/tools/bin/artifact-ingress-env.sh");

function runFixture(
  proof?: string,
  reviewedConfig = reviewed,
): {
  applied: string;
  appliedOutcome: boolean;
  fdClosed: boolean;
  fd8Sentinel: string;
  proofFdMarker: string;
  reviewed: string;
  reviewedMarker: string;
  token: string;
} {
  const args = proof
    ? [
        "-c",
        'exec 8<<<sentinel; exec {proof_fd}<<<"$1"; export VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD="$proof_fd"; exec "$2" --experimental-strip-types --import "$3" "$4"',
        "reviewed-config-fixture",
        proof,
        process.execPath,
        zxInit,
        fixture,
      ]
    : [
        "-c",
        'exec "$1" --experimental-strip-types --import "$2" "$3"',
        "reviewed-config-fixture",
        process.execPath,
        zxInit,
        fixture,
      ];
  const result = spawnSync(canonicalBash, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN: "expected-proof",
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: reviewedConfig,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("reviewed cache config crosses only a matching bounded FD proof", () => {
  const accepted = runFixture("expected-proof");
  assert.equal(accepted.appliedOutcome, true);
  assert.equal(accepted.reviewed, reviewed);
  assert.equal(accepted.fdClosed, true);
  assert.equal(accepted.fd8Sentinel, "sentinel");
  assert.equal(accepted.proofFdMarker, "");
  assert.equal(accepted.applied, "");
  assert.equal(accepted.reviewedMarker, "");
  assert.equal(accepted.token, "");

  for (const rejected of [
    runFixture("mismatched-proof"),
    runFixture("expected-proof\ntrailing"),
    runFixture("x".repeat(128)),
    runFixture(),
  ]) {
    assert.equal(rejected.appliedOutcome, false);
    assert.equal(rejected.reviewed, "");
    assert.equal(rejected.applied, "");
    assert.equal(rejected.reviewedMarker, "");
    assert.equal(rejected.token, "");
  }
});

test("healthy cache review crosses the FD proof without inventing NIX_CONFIG", () => {
  const accepted = runFixture("expected-proof", "");
  assert.equal(accepted.appliedOutcome, true);
  assert.equal(accepted.reviewed, "");
  assert.equal(accepted.applied, "");
  assert.equal(accepted.reviewedMarker, "");
});

test("shell ingress preserves inherited descriptors and stderr", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-stderr-"));
  try {
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "bin", "zx-wrapper"),
      [
        "#!/usr/bin/env bash",
        "IFS= read -r sentinel <&8",
        'proof_fd="${VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD:-}"',
        'proof=""',
        'if [[ -n "$proof_fd" ]]; then IFS= read -r proof <&"$proof_fd"; fi',
        'printf "sentinel=%s\\nproof-fd=%s\\nproof-matched=%s\\n" "$sentinel" "$proof_fd" "$([[ -z "$proof_fd" || "$proof" == "$VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN" ]] && printf 1 || printf 0)"',
        "printf 'ingress-stderr-preserved\\n' >&2",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    for (const mode of ["absent", "healthy", "present"]) {
      const result = spawnSync(
        canonicalBash,
        [
          "-c",
          'printf "sentinel\\n" > "$3"; exec 8<> "$3"; . "$1"; fake_tools_root="$2"; artifact_ingress_tools_root() { printf "%s\\n" "$fake_tools_root"; }; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; if [[ "$4" != absent ]]; then export VBR_NIX_CACHE_HEALTH_APPLIED=1; fi; if [[ "$4" == present ]]; then export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=reviewed; fi; artifact_ingress_exec /workspace ignored',
          "artifact-ingress-test",
          ingressScript,
          root,
          path.join(root, "fd8-sentinel"),
          mode,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
      assert.match(result.stderr, /ingress-stderr-preserved/);
      assert.match(result.stdout, /sentinel=sentinel/);
      assert.match(result.stdout, /proof-matched=1/);
      if (mode !== "absent") {
        assert.match(result.stdout, /proof-fd=[0-9]+/);
        assert.doesNotMatch(result.stdout, /proof-fd=8(?:\n|$)/);
      } else {
        assert.match(result.stdout, /proof-fd=\n/);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonical re-entry binds exact reviewed config bytes to their digest", () => {
  const expected = canonicalArtifactReentryEnvironment(process.cwd(), toolsRoot, {
    nixCacheHealth: { applied: true, config: reviewed },
  });
  assert.equal(expected.NIX_CONFIG, reviewed);
  assert.match(String(expected.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST || ""), /^[a-f0-9]{64}$/);
  assert.equal(isCanonicalArtifactEntrypointEnvironment(expected, expected), true);
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...expected, NIX_CONFIG: `${reviewed}\nconnect-timeout = 99` },
      expected,
    ),
    false,
  );
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...expected, VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST: "0".repeat(64) },
      expected,
    ),
    false,
  );
});

test("canonical re-entry binds a healthy empty cache decision to its digest", () => {
  const expected = canonicalArtifactReentryEnvironment(process.cwd(), toolsRoot, {
    nixCacheHealth: { applied: true, config: "" },
  });
  assert.equal(expected.NIX_CONFIG, undefined);
  assert.match(String(expected.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST || ""), /^[a-f0-9]{64}$/);
  assert.equal(isCanonicalArtifactEntrypointEnvironment(expected, expected), true);
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...expected, NIX_CONFIG: "substituters = https://cache.nixos.org/" },
      expected,
    ),
    false,
  );
});
