#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureRepoLocalTmpRoot } from "../../dev/verify/tmp-root";

test("verify contract: TMPDIR policy + coverage gating + disk gate strings present", async () => {
  const tmpRoot = await fsp.readFile("viberoots/build-tools/tools/dev/verify/tmp-root.ts", "utf8");
  const coverage = await fsp.readFile("viberoots/build-tools/tools/dev/verify/coverage.ts", "utf8");
  const housekeeping = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/housekeeping.ts",
    "utf8",
  );
  const runVerify = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/run-verify.ts",
    "utf8",
  );
  const vWrapper = await fsp.readFile("viberoots/build-tools/tools/bin/v", "utf8");
  const signalShutdown = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/signal-shutdown.ts",
    "utf8",
  );
  const runVerifyState = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/run-verify-state.ts",
    "utf8",
  );
  const finalOrphanCleanup = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/final-orphan-cleanup.ts",
    "utf8",
  );
  const startupWorkspaceState = await fsp.readFile(
    "viberoots/build-tools/tools/dev/startup-check/workspace-state.ts",
    "utf8",
  );
  const registeredToolState = await fsp.readFile(
    "viberoots/build-tools/tools/dev/registered-tool-state.ts",
    "utf8",
  );
  const devBuildRootCleanup = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/root-buck-out-cleanup.ts",
    "utf8",
  );

  assert.ok(
    tmpRoot.includes('platform === "linux"'),
    "expected verify TMPDIR policy to branch for Linux hosts",
  );
  assert.ok(
    tmpRoot.includes('"/tmp"') && tmpRoot.includes("viberoots-verify"),
    "expected verify to place Linux temp repos outside the workspace under /tmp",
  );
  assert.ok(
    tmpRoot.includes('TEST_TMP_IN_REPO = "1"'),
    "expected non-Linux/non-Darwin verify runs to keep using workspace-local temp repos",
  );
  assert.ok(
    tmpRoot.includes("markMacosMetadataNeverIndex") && tmpRoot.includes("../../lib/macos-metadata"),
    "expected macOS repo-local verify temp roots to opt out of Spotlight indexing through the shared helper",
  );
  assert.ok(
    runVerifyState.includes('".viberoots"') &&
      runVerifyState.includes('"workspace"') &&
      runVerifyState.includes('"buck"') &&
      runVerifyState.includes('"tmp"'),
    "expected verify reaper state to live under hidden workspace buck state",
  );
  assert.ok(
    runVerify.includes('"verify-analysis"') &&
      runVerify.includes('".viberoots"') &&
      runVerify.includes('"workspace"') &&
      runVerify.includes('"buck"'),
    "expected verify analysis state to live under hidden workspace buck state",
  );
  assert.ok(
    finalOrphanCleanup.includes("final-cleanup-root-buck-out") &&
      !finalOrphanCleanup.includes('name === ".metadata_never_index"') &&
      finalOrphanCleanup.includes("markMacosMetadataNeverIndex(buckOut)") &&
      finalOrphanCleanup.includes("VBR_VERIFY_BROAD_BUCK_OUT_CLEANUP") &&
      finalOrphanCleanup.includes("ownerPid") &&
      finalOrphanCleanup.includes("process.kill(Number(ownerPid), 0)") &&
      finalOrphanCleanup.includes('name === "test-logs"') &&
      finalOrphanCleanup.includes('name === "zx_shims"') &&
      finalOrphanCleanup.includes('name === "v2"') &&
      finalOrphanCleanup.includes('execFileAsync("buck2", ["kill"]') &&
      finalOrphanCleanup.includes('execFileAsync("buck2", ["--isolation-dir", name, "kill"]') &&
      finalOrphanCleanup.includes('name.startsWith("v-")') &&
      finalOrphanCleanup.includes('name.startsWith("verify-nested-")') &&
      finalOrphanCleanup.includes('name.startsWith("deployment-query-")') &&
      finalOrphanCleanup.includes('name.startsWith("zxtest-shared-")') &&
      finalOrphanCleanup.includes('name.startsWith("exporter-shared-")') &&
      finalOrphanCleanup.includes("activeSourceCleanupRoots") &&
      finalOrphanCleanup.includes('path.join(root, "viberoots")') &&
      finalOrphanCleanup.includes('".viberoots", "current"'),
    "expected final verify cleanup to preserve live owner-encoded isolations and require explicit opt-in before broad Buck cleanup under exact workspace/source roots",
  );
  assert.ok(
    vWrapper.includes("cleanup_verify_owned_buck_out_roots") &&
      !vWrapper.includes(".metadata_never_index|") &&
      vWrapper.includes('"${SCRIPT_DIR}/verify" "$@"') &&
      vWrapper.includes(
        'cleanup_verify_owned_buck_out_roots "${VBR_VERIFY_BROAD_BUCK_OUT_CLEANUP:-0}"',
      ) &&
      !vWrapper.includes("cleanup_verify_owned_buck_out_roots 1") &&
      vWrapper.includes('allow_broad_buck_cleanup="${1:-0}"') &&
      vWrapper.includes("v-*|verify-nested-*") &&
      vWrapper.includes(
        "test-logs|tmp|zx_shims|v2|deployment-query-*|zxtest-shared-*|exporter-shared-*",
      ) &&
      vWrapper.includes("buck2 kill") &&
      vWrapper.includes("registered_isolation_owner_alive") &&
      vWrapper.includes("VBR_VERIFY_PROCESS_STATE_FILE") &&
      vWrapper.includes("ownerPid") &&
      vWrapper.includes("repoRoot") &&
      vWrapper.includes("LIVE_ROOT") &&
      vWrapper.includes("VIBEROOTS_ROOT") &&
      vWrapper.includes("cleanup_root"),
    "expected v wrapper to avoid broad Buck cleanup by default while preserving an explicit opt-in for stale broad cleanup under exact workspace/source roots",
  );
  assert.ok(
    startupWorkspaceState.includes("cleanupVerifyOwnedRootBuckOut") &&
      !startupWorkspaceState.includes('name === ".metadata_never_index"') &&
      startupWorkspaceState.includes("VBR_STARTUP_BROAD_BUCK_OUT_CLEANUP") &&
      startupWorkspaceState.includes("ownerPid") &&
      startupWorkspaceState.includes("process.kill(Number(ownerPid), 0)") &&
      startupWorkspaceState.includes('name === "v2"') &&
      startupWorkspaceState.includes('execFileAsync("buck2", ["kill"]') &&
      startupWorkspaceState.includes('name.startsWith("v-")') &&
      startupWorkspaceState.includes('name.startsWith("verify-nested-")') &&
      startupWorkspaceState.includes('name.startsWith("zxtest-shared-")') &&
      startupWorkspaceState.includes('name.startsWith("exporter-shared-")') &&
      startupWorkspaceState.includes("findExtractionBlockers(process.cwd())"),
    "expected startup-check to avoid broad Buck cleanup by default and only clean stale owner-encoded verify isolations unless explicitly opted in",
  );
  assert.ok(
    registeredToolState.includes('".viberoots"') &&
      registeredToolState.includes('"workspace"') &&
      registeredToolState.includes('"buck"') &&
      registeredToolState.includes('"test-logs"') &&
      !registeredToolState.includes('"buck-out"'),
    "expected generic tool process state and cleanup logs to live under hidden workspace buck state",
  );
  assert.ok(
    devBuildRootCleanup.includes("isSharedDevBuildRootBuckOutEntry") &&
      !devBuildRootCleanup.includes('name === ".housekeeping"') &&
      devBuildRootCleanup.includes('name.startsWith("devbuild-")') &&
      devBuildRootCleanup.includes('name.startsWith("exporter-")') &&
      devBuildRootCleanup.includes("buck2 --isolation-dir"),
    "expected dev-build cleanup to remove throwaway dev-build root buck-out entries while preserving no-op state for reusable builds",
  );

  assert.ok(
    housekeeping.includes("VERIFY_TARGET_FREE_GB"),
    "expected verify to honor VERIFY_TARGET_FREE_GB (disk gate threshold)",
  );
  assert.ok(
    housekeeping.includes("emptyDirectoryPreservingMacosMetadataExclusion") &&
      housekeeping.includes('path.join(root, "buck-out", "test-logs")') &&
      !housekeeping.includes('.rm(path.join(root, "buck-out", "test-logs")'),
    "expected verify housekeeping to preserve the test-logs metadata exclusion marker while clearing stale log contents",
  );
  assert.ok(
    housekeeping.includes("refused to start"),
    "expected verify to refuse to start when free space remains below the target threshold",
  );

  assert.ok(
    coverage.includes("NODE_V8_COVERAGE") && coverage.includes("enabled"),
    "expected verify coverage to gate raw V8 coverage output behind explicit coverage mode",
  );

  assert.ok(
    !runVerify.includes("process.env.TEST_TIMING_SUMMARY ="),
    "expected verify not to force per-test timing summaries into Buck event streams",
  );

  assert.ok(
    runVerify.includes("installVerifySignalHandlers(requestShutdown)") &&
      signalShutdown.includes("[verify] forcing exit after") &&
      signalShutdown.includes("process.exit(exitCode)"),
    "expected verify signal cleanup to terminate the parent process and release the verify lock",
  );

  const verifyPasses = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/verify-passes.ts",
    "utf8",
  );
  assert.ok(
    runVerify.includes("activeNestedIsos") &&
      runVerify.includes("onNestedIso:") &&
      runVerify.includes("onNestedIsoDone:"),
    "expected verify signal cleanup to track active nested Buck isolations",
  );
  assert.ok(
    verifyPasses.includes("spawned.nestedIso") &&
      verifyPasses.includes("killBuckIsolation(opts.root, spawned.nestedIso)"),
    "expected verify passes to kill child Buck nested isolations after each pass",
  );
  assert.ok(
    verifyPasses.includes("aggregateStatus") &&
      verifyPasses.includes(
        "if (status !== 0 && aggregateStatus === 0) aggregateStatus = status",
      ) &&
      verifyPasses.includes(
        "return shouldAbort() && aggregateStatus === 0 ? 130 : aggregateStatus",
      ),
    "expected verify pass scheduling to run later pass groups after earlier pass failures",
  );
});

test("verify macOS temp roots opt generated output trees out of metadata indexing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-tmp-root-"));
  const env: NodeJS.ProcessEnv = {};
  const user = os.userInfo().username || "";
  const suffix = user ? `-${user}` : "";
  const systemTmpRoot = path.join(root, "system-tmp");
  const expectedTmpdirLogical = path.join(
    systemTmpRoot,
    `viberoots-verify${suffix}.noindex`,
    "tmpdir",
  );

  try {
    const staleSystemFile = path.join(expectedTmpdirLogical, "stale-temp-repo", "file.txt");
    const staleFile = path.join(
      root,
      "buck-out",
      "tmp",
      "tmpdir.noindex",
      "stale-temp-repo",
      "file.txt",
    );
    const staleOldTmpdirFile = path.join(
      root,
      "buck-out",
      "tmp",
      "tmpdir",
      "stale-temp-repo",
      "file.txt",
    );
    await fsp.mkdir(path.dirname(staleSystemFile), { recursive: true });
    await fsp.writeFile(staleSystemFile, "system", "utf8");
    await fsp.mkdir(path.dirname(staleFile), { recursive: true });
    await fsp.writeFile(staleFile, "stale", "utf8");
    await fsp.mkdir(path.dirname(staleOldTmpdirFile), { recursive: true });
    await fsp.writeFile(staleOldTmpdirFile, "legacy", "utf8");

    await ensureRepoLocalTmpRoot(root, { env, platform: "darwin", systemTmpRoot });
    const expectedTmpdir = await fsp.realpath(expectedTmpdirLogical);

    assert.equal(env.TEST_TMP_IN_REPO, undefined);
    assert.equal(env.TMPDIR, expectedTmpdir);
    await assert.rejects(
      fsp.stat(staleSystemFile),
      "expected verify to clear stale macOS system temp dirs",
    );
    await assert.rejects(
      fsp.stat(staleFile),
      "expected verify to clear stale repo-local temp dirs",
    );
    await assert.rejects(
      fsp.stat(staleOldTmpdirFile),
      "expected verify to clear legacy repo-local temp dirs",
    );
    await Promise.all(
      [
        path.join(root, ".metadata_never_index"),
        path.join(root, ".viberoots", ".metadata_never_index"),
        path.join(root, ".viberoots", "buck", ".metadata_never_index"),
        path.join(root, ".viberoots", "cache", ".metadata_never_index"),
        path.join(root, ".viberoots", "workspace", ".metadata_never_index"),
        path.join(root, ".viberoots", "workspace", "buck", ".metadata_never_index"),
        path.join(root, ".viberoots", "workspace", "buck", "tmp", ".metadata_never_index"),
        path.join(root, ".viberoots", "workspace", "buck", "test-logs", ".metadata_never_index"),
        path.join(root, ".viberoots", "workspace", "buck", "verify-logs", ".metadata_never_index"),
        path.join(root, ".direnv", ".metadata_never_index"),
        path.join(root, "buck-out", ".metadata_never_index"),
        path.join(root, "buck-out", "tmp", ".metadata_never_index"),
        path.join(root, "buck-out", "test-logs", ".metadata_never_index"),
        path.join(path.dirname(expectedTmpdir), ".metadata_never_index"),
        path.join(expectedTmpdir, ".metadata_never_index"),
      ].map(async (marker) => {
        const stat = await fsp.stat(marker);
        assert.ok(stat.isFile(), `expected marker file at ${marker}`);
      }),
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
