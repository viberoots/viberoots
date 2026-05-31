#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { publishCloudflarePagesStaticWebapp } from "../../deployments/cloudflare-pages-publisher";
import {
  claimBackendQueuedSubmission,
  enqueueBackendSubmission,
  localHarnessControlPlaneDatabaseUrl,
  startBackendSubmissionClaimLease,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import type { runNixosSharedHostControlPlaneWorkerOnce } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import {
  readQueueClaimExpiry,
  waitForClaimRenewal,
} from "./nixos-shared-host.control-plane.backend.helpers";

type WorkerOnceOpts = Parameters<typeof runNixosSharedHostControlPlaneWorkerOnce>[0];

test("worker close aborts in-flight claim renewal and replacement claims after expiry", async () => {
  await runInTemp("control-plane-worker-close-inflight-lease", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await writeBackendSnapshotDoc(backend, { submissionId: "cp-inflight" }, `${tmp}/snapshot.json`);
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-inflight",
        submittedAt: "2026-05-01T10:00:00.000Z",
        deploymentId: "demoapp-dev",
        operationKind: "deploy",
        lockScope: "nixos-shared-host:default:demoapp",
        executionSnapshotPath: `${tmp}/snapshot.json`,
        lifecycleState: "queued",
      },
      { submissionPath: `${tmp}/submission.json`, executionSnapshotPath: `${tmp}/snapshot.json` },
    );
    await enqueueBackendSubmission(backend, "cp-inflight", "2026-05-01T10:00:00.000Z");

    let renewedExpiry = 0;
    let markInFlight: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      markInFlight = resolve;
    });
    const runOnce = async (opts: WorkerOnceOpts) => {
      const claimed = await claimBackendQueuedSubmission(backend, opts.workerId, 250);
      assert.ok(claimed);
      const lease = startBackendSubmissionClaimLease({
        backend,
        submissionId: claimed.submissionId,
        workerId: opts.workerId,
        claimToken: claimed.claimToken,
        claimMs: 250,
        heartbeatMs: 25,
        ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
      });
      renewedExpiry = await waitForClaimRenewal(
        backend,
        claimed.submissionId,
        await readQueueClaimExpiry(backend, claimed.submissionId),
      );
      markInFlight();
      await new Promise<void>((release) => {
        opts.abortSignal?.addEventListener("abort", release, { once: true });
      });
      await lease.stop();
      return true;
    };
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: tmp,
      backendDatabaseUrl: backend.databaseUrl,
      workerId: "worker-inflight",
      runOnce,
    });

    await inFlight;
    await worker.close();
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.ok((await readQueueClaimExpiry(backend, "cp-inflight")) >= renewedExpiry);
    const replacement = await claimBackendQueuedSubmission(backend, "worker-replacement", 250);
    assert.equal(replacement?.submissionId, "cp-inflight");
  });
});

test("stopped claim leases fail authority checks without extending expiry", async () => {
  await runInTemp("control-plane-stopped-lease-authority", async (tmp) => {
    const backend = { recordsRoot: tmp, databaseUrl: localHarnessControlPlaneDatabaseUrl(tmp) };
    await writeBackendSnapshotDoc(backend, { submissionId: "cp-stopped" }, `${tmp}/snapshot.json`);
    await writeBackendSubmissionDoc(
      backend,
      {
        submissionId: "cp-stopped",
        submittedAt: "2026-05-01T10:00:00.000Z",
        deploymentId: "demoapp-dev",
        operationKind: "deploy",
        lockScope: "nixos-shared-host:default:demoapp",
        executionSnapshotPath: `${tmp}/snapshot.json`,
        lifecycleState: "queued",
      },
      { submissionPath: `${tmp}/submission.json`, executionSnapshotPath: `${tmp}/snapshot.json` },
    );
    await enqueueBackendSubmission(backend, "cp-stopped", "2026-05-01T10:00:00.000Z");
    const claimed = await claimBackendQueuedSubmission(backend, "worker-stopped", 250);
    assert.ok(claimed);
    const abort = new AbortController();
    const lease = startBackendSubmissionClaimLease({
      backend,
      submissionId: claimed.submissionId,
      workerId: "worker-stopped",
      claimToken: claimed.claimToken,
      claimMs: 5_000,
      heartbeatMs: 60_000,
      abortSignal: abort.signal,
    });
    const expiryBeforeStop = await readQueueClaimExpiry(backend, claimed.submissionId);
    abort.abort();
    await assert.rejects(lease.assertCurrentAuthority(), { code: "worker_ownership_lost" });
    assert.equal(await readQueueClaimExpiry(backend, claimed.submissionId), expiryBeforeStop);
    await lease.stop();
    await assert.rejects(lease.assertCurrentAuthority(), { code: "worker_ownership_lost" });
    assert.equal(await readQueueClaimExpiry(backend, claimed.submissionId), expiryBeforeStop);
  });
});

test("provider and git child launch envs scrub control-plane ambient credentials", async () => {
  await runInTemp("control-plane-child-launch-env", async (tmp) => {
    const binDir = path.join(tmp, "bin");
    const wranglerPath = path.join(binDir, "wrangler");
    const logPath = path.join(tmp, "wrangler-env.json");
    const gitPath = path.join(binDir, "git");
    const gitLogPath = path.join(tmp, "git-env.json");
    const artifactDir = path.join(tmp, "artifact");
    const configPath = path.join(tmp, "wrangler.json");
    await fsp.mkdir(binDir, { recursive: true });
    await fsp.mkdir(artifactDir, { recursive: true });
    await fsp.writeFile(path.join(artifactDir, "index.html"), "ok\n", "utf8");
    await fsp.writeFile(configPath, JSON.stringify({ name: "pleomino-staging-pages" }), "utf8");
    await fsp.writeFile(
      wranglerPath,
      [
        "#!/usr/bin/env node",
        'import fs from "node:fs";',
        "fs.writeFileSync(process.env.VBR_WRANGLER_ENV_LOG, JSON.stringify(process.env));",
        'console.log(JSON.stringify({ url: "https://pleomino-staging-pages.pages.dev/" }));',
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );
    await fsp.writeFile(
      gitPath,
      [
        "#!/usr/bin/env node",
        'import fs from "node:fs";',
        "fs.writeFileSync(process.env.VBR_GIT_ENV_LOG, JSON.stringify(process.env));",
        'console.log("origin");',
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const previous = { ...process.env };
    process.env.PATH = `${binDir}:${previous.PATH || ""}`;
    process.env.VBR_CLOUDFLARE_PAGES_WRANGLER_BIN = wranglerPath;
    process.env.VBR_WRANGLER_ENV_LOG = logPath;
    process.env.VBR_GIT_ENV_LOG = gitLogPath;
    process.env.VBR_DEPLOY_CONTROL_PLANE_TOKEN = "ambient-control-plane-token";
    process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL = "postgres://ambient-control-plane";
    process.env.AWS_SECRET_ACCESS_KEY = "ambient-artifact-secret";
    process.env.CLOUDFLARE_API_TOKEN = "ambient-provider-token";
    try {
      await publishCloudflarePagesStaticWebapp({
        workspaceRoot: tmp,
        deployment: cloudflarePagesDeploymentFixture(),
        artifactDir,
        renderedConfigPath: configPath,
        apiToken: "reviewed-provider-token",
      });
      const wranglerEnv = JSON.parse(await fsp.readFile(logPath, "utf8"));
      assert.equal(wranglerEnv.CLOUDFLARE_API_TOKEN, "reviewed-provider-token");
      assert.equal(wranglerEnv.VBR_DEPLOY_CONTROL_PLANE_TOKEN, undefined);
      assert.equal(wranglerEnv.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL, undefined);
      assert.equal(wranglerEnv.AWS_SECRET_ACCESS_KEY, undefined);

      const gitStdout = await import("../../deployments/deployment-git-stdout");
      await gitStdout.deploymentGitStdout(tmp, ["remote"], {
        ...process.env,
        AWS_SECRET_ACCESS_KEY: "provided-artifact-secret",
        VBR_DEPLOY_CONTROL_PLANE_TOKEN: "provided-control-plane-token",
      });
      const helperGitEnv = JSON.parse(await fsp.readFile(gitLogPath, "utf8"));
      assert.equal(helperGitEnv.VBR_DEPLOY_CONTROL_PLANE_TOKEN, undefined);
      assert.equal(helperGitEnv.AWS_SECRET_ACCESS_KEY, undefined);

      const reviewedGit = await import("../../deployments/nixos-shared-host-reviewed-source-git");
      const gitEnv = await reviewedGit.gitFetchEnvForReviewedRemote(
        tmp,
        "git@github.com:owner/repo.git",
        { sshKeyFile: path.join(tmp, "key"), sshKnownHostsFile: path.join(tmp, "known_hosts") },
      );
      assert.equal(gitEnv.env?.VBR_DEPLOY_CONTROL_PLANE_TOKEN, undefined);
      assert.equal(gitEnv.env?.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL, undefined);
      assert.match(gitEnv.env?.GIT_SSH_COMMAND || "", /UserKnownHostsFile/);
      await gitEnv.cleanup();
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in previous)) delete process.env[name];
      }
      Object.assign(process.env, previous);
    }
  });
});
