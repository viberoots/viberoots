#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import { ecrRegistryProfile } from "./control-plane-registry-profile.fixture";

const DIGEST = `sha256:${"d".repeat(64)}`;
const IMAGE = `123456789012.dkr.ecr.us-east-1.amazonaws.com/deployment-control-plane@${DIGEST}`;
const BUILD_IDENTITY = `nix-source-${"e".repeat(64)}`;

test("image-publication command writes generated registry inspection evidence", async () => {
  await runInTemp("control-plane-image-publication-cli", async (tmp) => {
    const profile = path.join(tmp, "registry-profile.json");
    const out = path.join(tmp, "image-publication.json");
    const skopeo = await fakeSkopeo(tmp, DIGEST);
    await fsp.writeFile(profile, JSON.stringify(ecrRegistryProfile(), null, 2), "utf8");
    await withControlPlaneArgv(
      [
        "image-publication",
        "--registry-profile",
        profile,
        "--image",
        IMAGE,
        "--source-revision",
        "source-reviewed",
        "--image-build-identity",
        BUILD_IDENTITY,
        "--published-digest",
        DIGEST,
        "--tag",
        "source-reviewed",
        "--skopeo",
        skopeo,
        "--out",
        out,
      ],
      runDeploymentControlPlaneCommand,
    );
    const evidence = JSON.parse(await fsp.readFile(out, "utf8"));
    assert.equal(evidence.schemaVersion, "cloud-control-image-publication@1");
    assert.equal(evidence.image, IMAGE);
    assert.equal(evidence.digest, DIGEST);
    assert.equal(evidence.inspectedDigest, DIGEST);
    assert.equal(evidence.evidenceSource, "generated-command");
    assert.deepEqual(evidence.reviewedBuildCommands, reviewedBuildCommands());
    assert.equal(
      evidence.registryProfileSummary.runtimePull.credentialSource,
      "ec2-instance-profile",
    );
    assert.doesNotMatch(JSON.stringify(evidence), /Authorization|Bearer|password|secret=/i);
  });
});

test("image-publication command rejects digest mismatch, missing or malformed inspect output, and mutable identity", async () => {
  await runInTemp("control-plane-image-publication-negative", async (tmp) => {
    const profile = path.join(tmp, "registry-profile.json");
    await fsp.writeFile(profile, JSON.stringify(ecrRegistryProfile(), null, 2), "utf8");
    await assert.rejects(
      () => runImagePublication(tmp, profile, awaitableFakeSkopeo(tmp, `sha256:${"f".repeat(64)}`)),
      /digest does not match registry inspection/,
    );
    await assert.rejects(
      () => runImagePublication(tmp, profile, awaitableFakeSkopeo(tmp, "not-a-digest")),
      /registry inspection failed.*sha256/,
    );
    await assert.rejects(
      () => runImagePublication(tmp, profile, fakeEmptySkopeo(tmp)),
      /registry inspection failed.*sha256/,
    );
    const skopeo = await fakeSkopeo(tmp, DIGEST);
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          [
            "image-publication",
            "--registry-profile",
            profile,
            "--image",
            "repo/app:latest",
            "--skopeo",
            skopeo,
          ],
          runDeploymentControlPlaneCommand,
        ),
      /pinned by @sha256 digest/,
    );
  });
});

test("production AWS setup consumes generated image publication evidence path", async () => {
  await runInTemp("control-plane-setup-image-publication-evidence", async (tmp) => {
    const out = path.join(tmp, "profile");
    const evidence = path.join(tmp, "image-publication.json");
    const topology = path.join(tmp, "aws-topology-evidence.json");
    await fsp.writeFile(topology, JSON.stringify(topologyForImage()), "utf8");
    await fsp.writeFile(evidence, JSON.stringify(generatedEvidence(), null, 2), "utf8");
    await withControlPlaneArgv(
      [
        "setup",
        "--out",
        out,
        "--host-mode",
        "aws-ec2",
        "--image-publication-evidence",
        evidence,
        "--aws-topology-evidence",
        topology,
      ],
      runDeploymentControlPlaneCommand,
    );
    const profile = YAML.parse(await fsp.readFile(path.join(out, "aws-ec2-profile.yaml"), "utf8"));
    assert.equal(profile.imagePublication.image, IMAGE);
    assert.equal(profile.registryProfile.mode, "aws-ecr");
    assert.ok(await exists(path.join(out, "registry-profile.json")));
    const publication = JSON.parse(
      await fsp.readFile(path.join(out, "image-publication.json"), "utf8"),
    );
    assert.deepEqual(publication.reviewedBuildCommands, reviewedBuildCommands());
    const commands = JSON.parse(await fsp.readFile(path.join(out, "commands.json"), "utf8"));
    assert.match(JSON.stringify(commands), /deployment-control-plane image-publication/);
  });
});

test("production AWS setup rejects direct publication digest flags", async () => {
  await assert.rejects(
    () =>
      withControlPlaneArgv(
        [
          "setup",
          "--host-mode",
          "aws-ec2",
          "--image",
          IMAGE,
          "--expected-image-build-identity",
          BUILD_IDENTITY,
          "--image-source-revision",
          "source-reviewed",
          "--image-build-identity",
          BUILD_IDENTITY,
          "--image-publication-digest",
          DIGEST,
          "--image-inspected-digest",
          DIGEST,
        ],
        runDeploymentControlPlaneCommand,
      ),
    /requires --image-publication-evidence/,
  );
});

function generatedEvidence() {
  return {
    schemaVersion: "cloud-control-image-publication@1",
    image: IMAGE,
    sourceRevision: "source-reviewed",
    imageBuildIdentity: BUILD_IDENTITY,
    digest: DIGEST,
    inspectedDigest: DIGEST,
    tag: "123456789012.dkr.ecr.us-east-1.amazonaws.com/deployment-control-plane:source-reviewed",
    evidenceSource: "generated-command",
    registryProfile: ecrRegistryProfile(),
    reviewedBuildCommands: reviewedBuildCommands(),
  };
}

function topologyForImage() {
  const topology = privateLinkAwsTopology() as any;
  return {
    ...topology,
    compute: {
      ...topology.compute,
      processEvidence: { ...topology.compute.processEvidence, imageDigest: DIGEST },
      registryPullProof: { ...topology.compute.registryPullProof, image: IMAGE, digest: DIGEST },
    },
  };
}

async function runImagePublication(tmp: string, profile: string, skopeoPromise: Promise<string>) {
  const skopeo = await skopeoPromise;
  return withControlPlaneArgv(
    [
      "image-publication",
      "--registry-profile",
      profile,
      "--image",
      IMAGE,
      "--source-revision",
      "source-reviewed",
      "--image-build-identity",
      BUILD_IDENTITY,
      "--published-digest",
      DIGEST,
      "--skopeo",
      skopeo,
      "--out",
      path.join(tmp, "image-publication.json"),
    ],
    runDeploymentControlPlaneCommand,
  );
}

function awaitableFakeSkopeo(tmp: string, digest: string): Promise<string> {
  return fakeSkopeo(tmp, digest);
}

async function fakeSkopeo(tmp: string, digest: string): Promise<string> {
  const file = path.join(tmp, `fake-skopeo-${digest.replace(/[^a-z0-9]/gi, "")}.sh`);
  await fsp.writeFile(file, `#!/usr/bin/env bash\nprintf '%s\\n' '${digest}'\n`, "utf8");
  await fsp.chmod(file, 0o755);
  return file;
}

async function fakeEmptySkopeo(tmp: string): Promise<string> {
  const file = path.join(tmp, "fake-skopeo-empty.sh");
  await fsp.writeFile(file, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await fsp.chmod(file, 0o755);
  return file;
}

function reviewedBuildCommands(): string[] {
  return [
    "nix build .#deployment-control-plane-image",
    "nix build .#deployment-control-plane-image-contract",
  ];
}

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}
