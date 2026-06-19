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
    tmpRoot.includes(".metadata_never_index"),
    "expected macOS repo-local verify temp roots to opt out of Spotlight indexing",
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
      finalOrphanCleanup.includes('name === "test-logs"') &&
      finalOrphanCleanup.includes('name === "zx_shims"') &&
      finalOrphanCleanup.includes('name === "v2"') &&
      finalOrphanCleanup.includes("continue;") &&
      !finalOrphanCleanup.includes('execFileAsync("buck2", ["kill"]') &&
      finalOrphanCleanup.includes('name.startsWith("v-")') &&
      finalOrphanCleanup.includes('name.startsWith("verify-nested-")') &&
      finalOrphanCleanup.includes('name.startsWith("deployment-query-")') &&
      finalOrphanCleanup.includes('name.startsWith("zxtest-shared-")'),
    "expected final verify cleanup to leave default root v2 alone while killing isolated generated Buck daemons",
  );
  assert.ok(
    vWrapper.includes("cleanup_verify_root_buck_out") &&
      vWrapper.includes('"${SCRIPT_DIR}/verify" "$@"') &&
      vWrapper.includes("cleanup_verify_root_buck_out 1") &&
      vWrapper.includes("cleanup_verify_root_buck_out 0\nexit") &&
      vWrapper.includes('allow_default_buck_kill="${1:-0}"') &&
      vWrapper.includes("v2|v-*|verify-nested-*|deployment-query-*|zxtest-shared-*") &&
      vWrapper.includes("buck2 kill") &&
      vWrapper.includes("registered_isolation_owner_alive") &&
      vWrapper.includes("VBR_VERIFY_PROCESS_STATE_FILE") &&
      vWrapper.includes("ownerPid") &&
      vWrapper.includes("repoRoot") &&
      vWrapper.includes("LIVE_ROOT"),
    "expected v wrapper to kill default Buck only before verify and to avoid deleting live registered isolations",
  );
  assert.ok(
    startupWorkspaceState.includes("cleanupVerifyOwnedRootBuckOut") &&
      startupWorkspaceState.includes('name === "v2"') &&
      startupWorkspaceState.includes('execFileAsync("buck2", ["kill"]') &&
      startupWorkspaceState.includes('name.startsWith("zxtest-shared-")') &&
      startupWorkspaceState.includes("findExtractionBlockers(process.cwd())"),
    "expected startup-check to kill Buck daemons before cleaning generated root buck-out entries",
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
    devBuildRootCleanup.includes('name === ".housekeeping"') &&
      devBuildRootCleanup.includes('name.startsWith("devbuild-")') &&
      devBuildRootCleanup.includes('name.startsWith("exporter-")') &&
      devBuildRootCleanup.includes("buck2 --isolation-dir"),
    "expected dev-build cleanup to remove dev-build-owned root buck-out entries and kill their daemons",
  );

  assert.ok(
    housekeeping.includes("VERIFY_TARGET_FREE_GB"),
    "expected verify to honor VERIFY_TARGET_FREE_GB (disk gate threshold)",
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
      verifyPasses.includes("return aggregateStatus") &&
      !verifyPasses.includes("return status;\n    }\n  }\n\n  return 0;"),
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
        path.join(root, "buck-out", ".metadata_never_index"),
        path.join(root, "buck-out", "tmp", ".metadata_never_index"),
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
