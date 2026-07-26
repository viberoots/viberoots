#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";

const viberootsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixture = path.join(
  viberootsRoot,
  "build-tools/tools/tests/dev/canonical-artifact-reviewed-config-handoff.fixture.ts",
);
const zxInit = path.join(viberootsRoot, "build-tools/tools/dev/zx-init.mjs");
const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
const required = "https://required.example/cache";
const optional = "https://optional.example/cache";
const toolsRoot = canonicalArtifactToolsRoot(
  process.cwd(),
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);
const canonicalBash = path.join(toolsRoot, "bin", "bash");
const ingressScript = path.join(viberootsRoot, "build-tools/tools/bin/artifact-ingress-env.sh");

function runFixture(
  proof?: string,
  reviewedConfig = reviewed,
  markers: {
    required?: string;
    optional?: string;
    policy?: string;
  } = {},
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
      VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS: markers.required ?? required,
      VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS: markers.optional ?? optional,
      VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY: markers.policy ?? "auto",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function proofPayload(
  args: {
    token?: string;
    config?: string;
    required?: string;
    optional?: string;
    policy?: string;
  } = {},
): string {
  return [
    "vbr-nix-cache-review@1",
    args.token ?? "expected-proof",
    args.policy ?? "auto",
    args.required ?? required,
    args.optional ?? optional,
    args.config ?? reviewed,
  ].join("\n");
}

test("reviewed cache config crosses only a matching bounded FD proof", () => {
  const accepted = runFixture(proofPayload());
  assert.equal(accepted.appliedOutcome, true);
  assert.equal(accepted.reviewed, reviewed);
  assert.equal(accepted.fdClosed, true);
  assert.equal(accepted.fd8Sentinel, "sentinel");
  assert.equal(accepted.proofFdMarker, "");
  assert.equal(accepted.applied, "");
  assert.equal(accepted.reviewedMarker, "");
  assert.equal(accepted.token, "");

  for (const rejected of [
    runFixture(proofPayload({ token: "mismatched-proof" })),
    runFixture("expected-proof\ntrailing"),
    runFixture("x".repeat(4096)),
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
  const accepted = runFixture(proofPayload({ config: "" }), "");
  assert.equal(accepted.appliedOutcome, true);
  assert.equal(accepted.reviewed, "");
  assert.equal(accepted.applied, "");
  assert.equal(accepted.reviewedMarker, "");
});

test("forged reviewed role markers cannot cross a valid config proof", () => {
  for (const rejected of [
    runFixture(proofPayload(), reviewed, { optional: "https://forged.example/cache" }),
    runFixture(proofPayload(), reviewed, { required: "https://forged.example/cache" }),
    runFixture(proofPayload(), reviewed, { policy: "strict" }),
    runFixture(proofPayload({ config: `${reviewed}\nconnect-timeout = 99` })),
  ]) {
    assert.equal(rejected.appliedOutcome, false);
    assert.equal(rejected.reviewed, "");
  }
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
        'if [[ -n "$proof_fd" ]]; then IFS= read -r _proof_magic <&"$proof_fd"; IFS= read -r proof <&"$proof_fd"; fi',
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
          'printf "sentinel\\n" > "$3"; exec 8<> "$3"; . "$1"; fake_tools_root="$2"; artifact_ingress_tools_root() { printf "%s\\n" "$fake_tools_root"; }; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; if [[ "$4" != absent ]]; then export VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS= VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS= VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY=auto; fi; if [[ "$4" == present ]]; then export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=reviewed; fi; artifact_ingress_exec /workspace ignored',
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
