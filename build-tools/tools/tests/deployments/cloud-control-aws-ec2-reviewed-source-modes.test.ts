import assert from "node:assert/strict";
import { test } from "node:test";
import { $ } from "zx";
import { writeCloudControlSetupBundle } from "../../deployments/cloud-control-setup";
import YAML from "yaml";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { runInScratchTemp } from "../lib/test-helpers";

const SSH_FILES = ["reviewed-source-ssh-key", "reviewed-source-known-hosts"] as const;
const GITHUB_APP_FILES = [
  "reviewed-source-github-app-id",
  "reviewed-source-github-app-installation-id",
  "reviewed-source-github-app-private-key",
] as const;

test("AWS EC2 NixOS example renders SSH reviewed-source credentials only in SSH mode", () => {
  const bundle = renderCloudControlSetupBundle(instanceProfileInput());
  const wrapper = nixosWrapper(bundle);
  const config = YAML.parse(bundle.files["config.yaml"]!);
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  const map = JSON.parse(bundle.files["credential-map.json"]!);

  assert.match(wrapper, /reviewedSourceMode = "ssh";/);
  assertCredentialSources(wrapper, SSH_FILES);
  assertNoCredentialSources(wrapper, GITHUB_APP_FILES);
  assert.equal(config.reviewedSource.mode, "ssh");
  assert.equal(manifest.reviewedSourceMode, "ssh");
  assert.equal(map.reviewedSource.mode, "ssh");
  assertManifestIncludesOnly(manifest.requiredFiles, SSH_FILES, GITHUB_APP_FILES);
  assert.match(wrapper, /artifact-store-endpoint\.source/);
  assert.doesNotMatch(wrapper, /artifact-store-access-key-id\.source/);
  assert.doesNotMatch(wrapper, /artifact-store-secret-access-key\.source/);
});

test("AWS EC2 NixOS example renders GitHub App reviewed-source credentials only in GitHub App mode", () => {
  const bundle = renderCloudControlSetupBundle(
    ec2HostProfileInput({ reviewedSourceMode: "github-app" }),
  );
  const wrapper = nixosWrapper(bundle);
  const config = YAML.parse(bundle.files["config.yaml"]!);
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  const map = JSON.parse(bundle.files["credential-map.json"]!);

  assert.match(wrapper, /reviewedSourceMode = "github-app";/);
  assertCredentialSources(wrapper, GITHUB_APP_FILES);
  assertNoCredentialSources(wrapper, SSH_FILES);
  assert.equal(config.reviewedSource.mode, "github-app");
  assert.equal(manifest.reviewedSourceMode, "github-app");
  assert.equal(map.reviewedSource.mode, "github-app");
  assertManifestIncludesOnly(manifest.requiredFiles, GITHUB_APP_FILES, SSH_FILES);
});

test("AWS EC2 NixOS wrapper imports from bundle root and configures GitHub App mode", async () => {
  await runInScratchTemp("aws-ec2-github-app-nixos-wrapper", async (tmp) => {
    await writeCloudControlSetupBundle(
      ec2HostProfileInput({ outDir: tmp, reviewedSourceMode: "github-app" }),
    );
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            nixpkgs.hostPlatform = "x86_64-linux";
            imports = [ ./nixos/aws-ec2-control-plane-host.example.nix ];
            system.stateVersion = "24.11";
          };
        };
        runtimeConfig =
          builtins.fromJSON system.config.environment.etc."deployment-control-plane/config.yaml".text;
      in {
        reviewedSourceMode = runtimeConfig.reviewedSource.mode;
        loadCredentials =
          system.config.systemd.services.podman-deployment-control-plane-service.serviceConfig.LoadCredential;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const evaluated = JSON.parse(String(stdout || "{}"));

    assert.equal(evaluated.reviewedSourceMode, "github-app");
    assertLoadCredentialIncludesOnly(evaluated.loadCredentials, GITHUB_APP_FILES, SSH_FILES);
  });
});

function nixosWrapper(bundle: { files: Record<string, string> }): string {
  return bundle.files["nixos/aws-ec2-control-plane-host.example.nix"]!;
}

function assertCredentialSources(wrapper: string, files: readonly string[]): void {
  for (const file of files) {
    assert.match(wrapper, new RegExp(`${file}\\.source = "/run/secrets/${file}"`));
  }
}

function assertNoCredentialSources(wrapper: string, files: readonly string[]): void {
  for (const file of files) {
    assert.doesNotMatch(wrapper, new RegExp(`${file}\\.source`));
  }
}

function assertManifestIncludesOnly(
  requiredFiles: string[],
  expected: readonly string[],
  absent: readonly string[],
): void {
  for (const file of expected) assert.ok(requiredFiles.includes(file));
  for (const file of absent) assert.ok(!requiredFiles.includes(file));
}

function assertLoadCredentialIncludesOnly(
  loadCredentials: string[],
  expected: readonly string[],
  absent: readonly string[],
): void {
  for (const file of expected) {
    assert.ok(
      loadCredentials.some((entry) => entry.startsWith(`${file}:`)),
      file,
    );
  }
  for (const file of absent) {
    assert.ok(!loadCredentials.some((entry) => entry.startsWith(`${file}:`)), file);
  }
}

function instanceProfileInput() {
  const base = ec2HostProfileInput();
  return ec2HostProfileInput({
    artifactCredentialMode: "aws-instance-profile",
    artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
    artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    reviewedSourceMode: "ssh",
    runtimeInput: {
      ...base.runtimeInput!,
      provenance: {
        ...base.runtimeInput!.provenance,
        artifactCredentialMode: "aws-instance-profile",
      },
    },
  });
}
