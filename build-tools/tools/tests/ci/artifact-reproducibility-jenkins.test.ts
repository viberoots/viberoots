import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("Jenkins exposes only an explicitly enabled six-cell protected reproducibility gate", async () => {
  const jenkins = await fs.readFile(viberootsSourcePath("Jenkinsfile"), "utf8");
  const stage = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/artifact-reproducibility-stage.ts"),
    "utf8",
  );
  const aggregate = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/aggregate-artifact-reproducibility-evidence.ts"),
    "utf8",
  );
  const cell = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/produce-artifact-reproducibility-matrix-cell.ts"),
    "utf8",
  );
  const producer = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/produce-artifact-reproducibility-evidence.ts"),
    "utf8",
  );
  const preparation = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/prepare-artifact-reproducibility-bundle.ts"),
    "utf8",
  );
  assert.match(jenkins, /VBR_PROTECTED_REPRODUCIBILITY/);
  assert.match(jenkins, /--stage langs-validate/);
  assert.match(jenkins, /values 'aarch64-darwin', 'aarch64-linux', 'x86_64-linux'/);
  assert.match(jenkins, /name 'BUILDER_SLOT'; values 'one', 'two'/);
  assert.match(jenkins, /produce-artifact-reproducibility-matrix-cell\.ts/);
  assert.match(
    jenkins,
    /VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS\}\/share\/viberoots-source\/build-tools\/tools\/ci\/produce-artifact-reproducibility-matrix-cell\.ts/,
  );
  assert.match(jenkins, /aggregate-artifact-reproducibility-evidence\.ts/);
  assert.match(
    jenkins,
    /cell-\$\{SYSTEM\}-\$\{BUILDER_SLOT\}\/records\.txt,buck-out\/reproducibility\/cell-\$\{SYSTEM\}-\$\{BUILDER_SLOT\}\/observations\.txt/,
  );
  assert.doesNotMatch(jenkins, /\{records,observations\}/);
  assert.match(jenkins, /aggregate-observation-paths\.json/);
  for (const name of ["HOME", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]) {
    assert.match(jenkins, new RegExp(`export ${name}=`));
  }
  assert.match(jenkins, /for tool in nix git node buck2 zx-wrapper/);
  assert.match(jenkins, /poison artifact tool invoked/);
  assert.match(jenkins, /artifact build rejects ambient selectors:/);
  assert.doesNotMatch(jenkins, /rejects unreviewed artifact environment\|selector injection/);
  assert.match(jenkins, /"\$\{VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS\}\/bin\/zx-wrapper"/);
  assert.match(jenkins, /export PATH="\$poison_root\/bin:\$PATH"/);
  assert.match(jenkins, /LANG=C LC_ALL=C TZ=UTC0/);
  assert.match(jenkins, /LANG=en_US\.UTF-8 LC_ALL=en_US\.UTF-8 TZ=Etc\/UTC/);
  assert.doesNotMatch(jenkins, /--flake-ref|--target|--evidence-store(?:=|\s)/);
  assert.match(jenkins, /--evidence-store-aws-credentials-file/);
  assert.match(
    jenkins,
    /file\(credentialsId: 'secret:\/\/ci\/hermetic-builds\/reproducibility\/evidence-store-aws-shared-credentials', variable: 'VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE'\)/,
  );
  assert.match(
    jenkins,
    /file\(credentialsId: 'secret:\/\/ci\/hermetic-builds\/reproducibility\/evidence-signing-key', variable: 'VBR_REPRODUCIBILITY_SIGNING_KEY_FILE'\)/,
  );
  assert.doesNotMatch(jenkins, /credentialsId: '(?!secret:\/\/)/);
  assert.doesNotMatch(jenkins, /EVIDENCE_WRITE_TRANSPORT|evidence-store-write-transport/);
  const awsCredentialId =
    "secret://ci/hermetic-builds/reproducibility/evidence-store-aws-shared-credentials";
  assert.equal(jenkins.split(`credentialsId: '${awsCredentialId}'`).length - 1, 2);
  const matrixBinding = jenkins.indexOf(`credentialsId: '${awsCredentialId}'`);
  const matrixProducer = jenkins.indexOf("produce-artifact-reproducibility-matrix-cell.ts");
  const aggregateStage = jenkins.indexOf("Protected Artifact Reproducibility Aggregate");
  const aggregateBinding = jenkins.indexOf(`credentialsId: '${awsCredentialId}'`, aggregateStage);
  const aggregateProducer = jenkins.indexOf("aggregate-artifact-reproducibility-evidence.ts");
  assert.ok(
    matrixBinding >= 0 && matrixBinding < matrixProducer && matrixProducer < aggregateStage,
  );
  assert.ok(
    aggregateBinding > aggregateStage &&
      aggregateBinding < aggregateProducer &&
      jenkins.slice(aggregateBinding, aggregateProducer).includes("]) {"),
  );
  const matrixBindingEnd = jenkins.indexOf("\n                    stash name:", matrixBinding);
  const aggregateBindingEnd = jenkins.indexOf("\n              archiveArtifacts", aggregateBinding);
  const matrixCredentialBlock = jenkins.slice(matrixBinding, matrixBindingEnd);
  const aggregateCredentialBlock = jenkins.slice(aggregateBinding, aggregateBindingEnd);
  for (const forbidden of [
    "checkout scm",
    "git submodule",
    "./viberoots/init",
    "run-stage.sh",
    "mkdir -p",
    "for tool in",
    "for probe in",
    "artifact-environment-negative-probe.ts",
    "unstash ",
    "archiveArtifacts",
  ]) {
    assert.equal(matrixCredentialBlock.includes(forbidden), false);
    assert.equal(aggregateCredentialBlock.includes(forbidden), false);
  }
  assert.equal(matrixCredentialBlock.split("sh '''").length - 1, 1);
  assert.equal(aggregateCredentialBlock.split("sh '''").length - 1, 1);
  assert.match(matrixCredentialBlock, /chmod 600 .*EVIDENCE_AWS_CREDENTIALS_FILE/);
  assert.match(matrixCredentialBlock, /produce-artifact-reproducibility-matrix-cell\.ts/);
  assert.match(matrixCredentialBlock, /env -u NODE_PATH VBR_GC_MODE=off .*VBR_ARTIFACT_TOOLS_ROOT/);
  assert.doesNotMatch(matrixCredentialBlock, /aggregate-artifact-reproducibility-evidence\.ts/);
  assert.match(aggregateCredentialBlock, /chmod 600 .*EVIDENCE_AWS_CREDENTIALS_FILE/);
  assert.match(aggregateCredentialBlock, /chmod 600 .*SIGNING_KEY_FILE/);
  assert.match(aggregateCredentialBlock, /aggregate-artifact-reproducibility-evidence\.ts/);
  assert.match(
    aggregateCredentialBlock,
    /env -u NODE_PATH VBR_GC_MODE=off .*VBR_ARTIFACT_TOOLS_ROOT/,
  );
  assert.doesNotMatch(aggregateCredentialBlock, /produce-artifact-reproducibility-matrix-cell\.ts/);
  assert.ok(jenkins.lastIndexOf("run-stage.sh", matrixBinding) >= 0);
  assert.ok(jenkins.lastIndexOf("run-stage.sh", aggregateBinding) > aggregateStage);
  assert.match(stage, /reproducibility-matrix-cell/);
  assert.match(stage, /reproducibility-aggregate/);
  assert.match(cell, /bundle-one/);
  assert.match(cell, /bundle-two/);
  assert.match(cell, /withArtifactReproducibilityTempConsumer/);
  assert.match(cell, /producePublicationCellRecords/);
  assert.match(cell, /owned-root-cleanup\.json/);
  assert.match(cell, /observations\.txt/);
  assert.match(
    cell,
    /unchanged replay created a new source, bundle, revision, or binding identity/,
  );
  assert.doesNotMatch(producer, /rev-parse|tool: "git"/);
  assert.match(preparation, /args: \["rev-parse", "HEAD"\]/);
  assert.match(producer, /copyToEvidenceStore/);
  assert.match(producer, /storeUri: registry\.evidenceStore\.storeUri/);
  assert.ok(
    producer.indexOf("const observed = await withArtifactCommandLifecycle") <
      producer.indexOf("const activeSmoke = await runRemoteBuilderSmoke") &&
      producer.indexOf("const activeSmoke = await runRemoteBuilderSmoke") <
        producer.indexOf("const captured = await observeArtifactReproducibility") &&
      producer.indexOf("const captured = await observeArtifactReproducibility") <
        producer.indexOf("afterOperation"),
  );
  assert.match(producer, /remoteStoreBefore/);
  assert.match(producer, /remoteStoreAfterProbes/);
  assert.match(aggregate, /observation-summary\.json/);
  assert.match(aggregate, /build-tools\/tools\/nix\/langs\.json/);
  assert.ok(
    aggregate.indexOf("readJson(file") < aggregate.indexOf("signAndVerifyProtectedStore(root"),
  );
  assert.ok(
    aggregate.lastIndexOf("aggregateArtifactReproducibilityEvidence") <
      aggregate.lastIndexOf("signAndVerifyProtectedStore(root"),
  );
  assert.ok(
    jenkins.indexOf("Protected Artifact Reproducibility Aggregate") >
      jenkins.indexOf("Protected Artifact Reproducibility Production"),
  );
});
