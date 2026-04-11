#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeLaneGovernanceEvidence(
  tmp: string,
  $: any,
  deploymentJson: string,
  deployment: ReturnType<typeof nixosSharedHostDeploymentFixture>,
): Promise<string> {
  const snapshotPath = path.join(tmp, "scm-policy.json");
  const evidencePath = path.join(tmp, "admission-evidence.json");
  await fsp.writeFile(
    snapshotPath,
    JSON.stringify(
      {
        scmBackend: deployment.lanePolicy.governance.scmBackend,
        repository: deployment.lanePolicy.governance.repository,
        branchProtections: deployment.lanePolicy.governance.branchProtections,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const verified = await $({
    cwd: tmp,
    stdio: "pipe",
  })`zx-wrapper build-tools/tools/deployments/deployment-lane-governance-verify.ts --deployment-json ${deploymentJson} --scm-policy-json ${snapshotPath}`;
  await fsp.writeFile(
    evidencePath,
    JSON.stringify(
      {
        requestedBy: { principalId: "user:submitter" },
        laneGovernance: JSON.parse(String(verified.stdout)),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return evidencePath;
}

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeSsrArtifact(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, "dist", "server"), { recursive: true });
  await fsp.mkdir(path.join(root, "dist", "client"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "dist", "server", "index.js"),
    [
      "import http from 'node:http';",
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
      "const port = Number(process.env.PORT || '3000');",
      "const clientRoot = path.join(__dirname, '..', 'client');",
      "const server = http.createServer((req, res) => {",
      "  if (req.url === '/healthz') { res.writeHead(200); res.end('ok\\n'); return; }",
      "  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
      "  res.end(fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8'));",
      "});",
      "server.listen(port, process.env.HOST || '127.0.0.1');",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(root, "dist", "client", "index.html"),
    "<html>demoapp-ssr</html>\n",
    "utf8",
  );
}

test("nixos-shared-host deploy CLI completes the shared-dev static-webapp flow end to end", async () => {
  await runInTemp("nixos-shared-host-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeLaneGovernanceEvidence(
      tmp,
      $,
      deploymentJson,
      deployment,
    );
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${path.join(tmp, "records")} --host-config-out ${path.join(tmp, "rendered-host.json")} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.operationKind, "deploy");
      assert.equal(summary.runClassification, "deploy");
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://demoapp.apps.kilty.io/");
      assert.equal(summary.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.schemaVersion, "deploy-record@2026-04-10");
      assert.equal(record.deployRunId, summary.deployRunId);
      assert.equal(record.runClassification, "deploy");
      assert.equal(record.lifecycleState, "finished");
      assert.equal(record.provider, "nixos-shared-host");
      assert.equal(record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(record.controlPlane.submissionId, summary.controlPlane.submissionId);
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      assert.equal(
        record.controlPlane.executionSnapshotPath,
        summary.controlPlane.executionSnapshotPath,
      );
      assert.equal(record.admittedContext.source.sourceRef, "env/pleomino/dev");
      assert.equal(record.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
      assert.equal(record.artifact.identity, summary.artifactIdentity);
      assert.match(record.artifact.storedArtifactPath, /records\/artifacts\/blobs\//);
      assert.match(record.artifact.provenancePath, /records\/artifacts\/provenance\//);
      assert.match(record.deploymentMetadataFingerprint, /^sha256:/);
      assert.match(record.replaySnapshotPath, /records\/replay\//);
      assert.equal(record.finalOutcome, "succeeded");
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.operationKind, "deploy");
      assert.equal(snapshot.deploymentLabel, "//projects/deployments/demoapp-dev:deploy");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(snapshot.action.publishBehavior, "deploy");
      assert.equal(snapshot.admittedContext.source.sourceRef, "env/pleomino/dev");
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const replayInspect = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-replay-inspect.ts --record-path ${summary.recordPath}`;
      const replay = JSON.parse(String(replayInspect.stdout));
      assert.equal(replay.deployRunId, summary.deployRunId);
      assert.equal(replay.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(replay.publishInput.kind, "component-artifacts");
      assert.equal(replay.publishInput.components[0].artifact.identity, summary.artifactIdentity);
      assert.equal(replay.replaySnapshotPath, record.replaySnapshotPath);
      assert.equal(replay.deploymentMetadataFingerprint, record.deploymentMetadataFingerprint);
      assert.equal(replay.admittedContext.source.sourceRef, "env/pleomino/dev");
      const admissionInspect = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-admission-inspect.ts --record-path ${summary.recordPath}`;
      const admission = JSON.parse(String(admissionInspect.stdout));
      assert.equal(admission.admittedContext.environmentStage, "dev");
      assert.equal(admission.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
      assert.equal(
        admission.admittedContext.policyEvaluation.laneGovernance.governanceRef,
        deployment.lanePolicy.governanceRef,
      );
      const rendered = JSON.parse(await fsp.readFile(path.join(tmp, "rendered-host.json"), "utf8"));
      assert.ok(rendered.containers.demoapp);
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host deploy CLI completes the reviewed ssr-webapp flow end to end", async () => {
  await runInTemp("nixos-shared-host-ssr-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      component: { kind: "ssr-webapp", target: "//projects/apps/demoapp:app" },
      publisher: { type: "nixos-shared-host-ssr-webapp" },
      runtime: {
        appName: "demoapp",
        containerPort: 3000,
        healthPath: "/healthz",
        runtimeContract: {
          type: "node-dist-server-v1",
          framework: "vite",
          serverEntry: "dist/server/index.js",
          clientDir: "dist/client",
          servingTopology: "single-host-node-with-nginx",
          environmentNeutralBuild: true,
          runtimeConfigInjection: "runtime_config_requirements",
          secretInjection: "secret_requirements",
        },
      } as any,
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    await writeSsrArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeLaneGovernanceEvidence(
      tmp,
      $,
      deploymentJson,
      deployment,
    );
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${path.join(tmp, "records")} --host-config-out ${path.join(tmp, "rendered-host.json")} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://demoapp.apps.kilty.io/");
      const rendered = JSON.parse(await fsp.readFile(path.join(tmp, "rendered-host.json"), "utf8"));
      assert.equal(rendered.containers.demoapp.runtime, "ssr-webapp-host");
      assert.equal(
        rendered.containers.demoapp.serverEntry,
        "/srv/ssr-app/live/dist/server/index.js",
      );
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.publisherType, "nixos-shared-host-ssr-webapp");
      assert.equal(record.smokeRunnerType, "nixos-shared-host-ssr-webapp-smoke");
      assert.equal(record.componentResults[0].artifact.kind, "ssr-webapp");
      assert.equal(record.componentResults[0].artifactIdentity.startsWith("ssr-webapp:"), true);
    } finally {
      await server.close();
    }
  });
});
