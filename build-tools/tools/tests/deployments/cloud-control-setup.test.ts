import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import {
  CLOUD_CAPABILITY_IDS,
  REQUIRED_CAPABILITY_FIELDS,
} from "../../deployments/cloud-control-setup-contract";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { writeCloudControlSetupBundle } from "../../deployments/cloud-control-setup";
import {
  validateCloudControlSetupInput,
  validateProviderCapabilityDeclaration,
} from "../../deployments/cloud-control-setup-validate";
import {
  validateProtectedSharedProfileReadiness,
  validateRenderedProfile,
} from "../../deployments/cloud-control-setup-profile-validate";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { baseInput, BUILD_IDENTITY, DIGEST_REF } from "./cloud-control-setup.fixture";
import { runInScratchTemp } from "../lib/test-helpers";

test("cloud setup bundle renders runtime, credentials, commands, and capabilities", () => {
  const bundle = renderCloudControlSetupBundle(baseInput());
  const config = YAML.parse(bundle.files["config.yaml"]!);
  const compose = YAML.parse(bundle.files["compose.yaml"]!);
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const imagePublication = JSON.parse(bundle.files["image-publication.json"]!);
  const managed = JSON.parse(bundle.files["managed-dependencies.json"]!);
  const ingress = JSON.parse(bundle.files["ingress-checklist.json"]!);
  assert.equal(
    config.service.tokenFile,
    "/run/deployment-control-plane/credentials/control-plane-token",
  );
  assert.equal(config.storage.artifactStore.bucket, "deployment-control-plane-artifacts");
  assert.equal(config.authProvider.callback.externalHost, "deploy-auth.example.test");
  assert.equal(managed.postgres.candidate, "supabase-managed-postgres");
  assert.equal(managed.artifactStore.backend, "aws-s3");
  assert.equal(ingress.serviceIngress.readiness, "/readyz");
  assert.ok(manifest.requiredFiles.includes("sample-webapp-staging-infisical-client-secret"));
  assert.equal(config.credentials.infisicalDeployments[0].deploymentId, "sample-webapp-staging");
  assert.equal(config.reviewedSource.mode, "ssh");
  assert.equal(
    config.reviewedSource.sshKnownHostsFile,
    "/run/deployment-control-plane/credentials/reviewed-source-known-hosts",
  );
  assert.equal(commands.image, DIGEST_REF);
  assert.equal(commands.profileRoot.repoRootRelative, "unused");
  assert.equal(imagePublication.digestContract.publication.status, "verified-registry-publication");
  assert.equal(imagePublication.image, DIGEST_REF);
  assert.equal(
    compose.services["deployment-control-plane-service"].environment
      .VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS,
    "verified-registry-publication",
  );
  assert.equal(
    compose.services["deployment-control-plane-service"].environment
      .VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY,
    BUILD_IDENTITY,
  );
  assert.equal(
    commands.phases.find((phase: { id: string }) => phase.id === "process-start").commands.length,
    3,
  );
  assert.deepEqual(validateRenderedProfile(bundle.files), []);
  assert.deepEqual(
    bundle.capabilities.map((capability) => capability.id),
    [...CLOUD_CAPABILITY_IDS],
  );
  for (const capability of bundle.capabilities) {
    assert.deepEqual(validateProviderCapabilityDeclaration(capability), []);
    for (const field of REQUIRED_CAPABILITY_FIELDS) assert.ok((capability as any)[field]);
    assert.doesNotMatch(JSON.stringify(capability), /<reviewed|placeholder provider|<label>/i);
    assert.match(capability.iac.previewCommand, /control-plane provider-capability/);
  }
});

test("AWS EC2 profile records production boundaries and reviewed alternates", async () => {
  await runInScratchTemp("cloud-control-aws-setup", async (tmp) => {
    await writeCloudControlSetupBundle(baseInput({ outDir: tmp, mode: "aws-ec2" }));
    const awsProfile = await fsp.readFile(path.join(tmp, "aws-ec2-profile.yaml"), "utf8");
    const capabilities = JSON.parse(
      await fsp.readFile(path.join(tmp, "provider-capabilities.json"), "utf8"),
    );
    const aws = YAML.parse(awsProfile);
    assert.equal(aws.artifactBackend.defaultPath, "AWS S3 through a VPC endpoint");
    assert.equal(aws.processes.length, 3);
    assert.equal(aws.processes[0].name, "deployment-control-plane-service");
    for (const name of [
      "systemd/deployment-control-plane-service.service",
      "aws-ec2-podman-run.sh",
      "managed-dependencies.json",
      "ingress-checklist.json",
    ]) {
      await fsp.access(path.join(tmp, name));
    }
    assert.equal(capabilities.length, CLOUD_CAPABILITY_IDS.length);
  });
});

test("incomplete generated profiles cannot be marked protected/shared-ready", () => {
  const incomplete = {
    "credential-manifest.json": JSON.stringify({ requiredFiles: ["control-plane-token"] }),
    "saas-oci-profile.yaml": `
schemaVersion: cloud-control-saas-oci-profile@1
processes:
  - name: deployment-control-plane-service
    image: ${DIGEST_REF}
    command: ["service"]
    mounts: []
protectedSharedReady: true
`,
  };
  assert.match(
    validateProtectedSharedProfileReadiness(incomplete).join("\n"),
    /cannot be marked protected\/shared-ready.*missing worker 1.*credentials\.infisicalDeployments/s,
  );
  assert.deepEqual(
    validateProtectedSharedProfileReadiness(renderCloudControlSetupBundle(baseInput()).files),
    [],
  );
});

test("every generated profile mode has runnable service and worker structure", () => {
  for (const mode of ["compose-podman", "nixos", "saas-oci", "aws-ec2"] as const) {
    const bundle = renderCloudControlSetupBundle(baseInput({ mode }));
    assert.deepEqual(validateRenderedProfile(bundle.files), [], mode);
  }
  assert.match(
    validateRenderedProfile({ "compose.yaml": "services:\n  placeholder-only: {}\n" }).join("\n"),
    /missing service process.*missing worker 1.*missing worker 2/s,
  );
});

test("GitHub App reviewed-source mode emits runtime-consumable credential files", () => {
  const bundle = renderCloudControlSetupBundle(baseInput({ reviewedSourceMode: "github-app" }));
  const config = YAML.parse(bundle.files["config.yaml"]!);
  const manifest = JSON.parse(bundle.files["credential-manifest.json"]!);
  assert.deepEqual(
    validateCloudControlSetupInput(baseInput({ reviewedSourceMode: "github-app" })),
    [],
  );
  assert.equal(config.reviewedSource.mode, "github-app");
  assert.equal(
    config.reviewedSource.githubAppPrivateKeyFile,
    "/run/deployment-control-plane/credentials/reviewed-source-github-app-private-key",
  );
  assert.ok(manifest.requiredFiles.includes("reviewed-source-github-app-id"));
  assert.ok(manifest.requiredFiles.includes("reviewed-source-github-app-installation-id"));
  assert.ok(manifest.requiredFiles.includes("reviewed-source-github-app-private-key"));
  assert.ok(!manifest.requiredFiles.includes("reviewed-source-ssh-key"));
});

test("cloud setup validation rejects tag-only images, weak topology, and missing AWS evidence", () => {
  assert.match(
    validateCloudControlSetupInput(
      baseInput({ image: "registry.example.com/control-plane:latest" }),
    ).join("\n"),
    /pinned by @sha256 digest/,
  );
  assert.match(
    validateCloudControlSetupInput(baseInput({ imagePublication: undefined })).join("\n"),
    /requires verified publication evidence/,
  );
  assert.match(
    validateCloudControlSetupInput(
      baseInput({ expectedImageBuildIdentity: `nix-source-${"c".repeat(64)}` }),
    ).join("\n"),
    /does not match expected build identity/,
  );
  assert.match(
    validateCloudControlSetupInput(baseInput({ workerReplicas: 1 })).join("\n"),
    /at least two workers/,
  );
  assert.match(
    validateCloudControlSetupInput(
      baseInput({
        mode: "aws-ec2",
        awsTopology: { ...privateLinkAwsTopology(), privateSubnets: [] },
      }),
    ).join("\n"),
    /private subnet evidence/,
  );
});

test("generated profile files do not embed secret values", async () => {
  await runInScratchTemp("cloud-control-secret-free", async (tmp) => {
    const outDir = path.join(tmp, "cloud-control-profile");
    await writeCloudControlSetupBundle(baseInput({ outDir }));
    for (const entry of await fsp.readdir(outDir, { recursive: true, withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      const text = await fsp.readFile(file, "utf8");
      assert.doesNotMatch(
        text,
        /AKIA[0-9A-Z]{16}|SECRET_ACCESS_KEY\s*=\s*['"]?[A-Za-z0-9/+=]{40}|BEGIN .*PRIVATE KEY/,
      );
      assert.doesNotMatch(
        text,
        /postgres(?:ql)?:\/\/[A-Za-z0-9._%+-]+:(?!(?:REDACTED|replace-me)@)[^@\s'"]+@[A-Za-z0-9.-]+/i,
      );
    }
  });
});
