import process from "node:process";
import { repoRoot } from "../dev-build/paths";
import { ensureBuckPreludeConfig } from "../dev-build/prelude";
import { runStartupCheck } from "../dev-build/startup";
import { parseVerifyArgs, parseVerifyExecutionPolicyForArgs } from "./args";
import { runMergedCoverageReport } from "./coverage";
import { runExplainSelection } from "./explain-selection";
import { runFinalOrphanBuckCleanup } from "./final-orphan-cleanup";
import { runVerifyLintPreflight } from "./lint-preflight";
import { acquireVerifyLock } from "./lock";
import { ensureVerifyPinnedNixpkgs } from "./nix-env";
import { applyNixCacheHealthPolicy } from "./nix-cache-health";
import { recordNixGcPreflight } from "./nix-gc-preflight";
import { createVerifyPhaseTimer } from "./phase-timing";
import { logVerifyRevision } from "./preflight";
import { prewarmVerifyOnce } from "./prewarm";
import { cleanupVerifyLegacyPnpmState } from "./pnpm-state";
import { resolveRequestedVerifyScope } from "./requested-scope";
import { summarizeVerifyScopeDecision } from "./selection-output";
import { installVerifySignalHandlers } from "./signal-shutdown";
import { createRegisteredStateCleaner } from "./registered-state-cleanup";
import { cleanupLocalOrphanBuckDaemons, setupLocalVerifyWorkspace } from "./run-local-setup";
import {
  appendVerifyLogLine,
  killBuckIsolation,
  killProcessGroup,
  startBuckDaemonReaper,
  startBuckWatchdog,
  writeVerifyIsoMarker,
} from "./process-control";
import { initializeVerifyProcessState } from "./run-verify-state";
import { prepareVerifySeed, shouldPrepareVerifySeedForRequestedTargets } from "./seed";
import { isNonBuildSystemOnlyVerifyTargets } from "./target-scope";
import { maybeWriteVerifyTimingSummary, runTemplateManifestCheck } from "./template-manifest-check";
import { ensureRepoLocalTmpRoot } from "./tmp-root";
import { runVerifyBuckPasses } from "./verify-passes";
import { computeZxTestNodeModulesOut } from "./zx-node-modules";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-tool-authority";

export const defaultRunVerifyDeps = {
  appendVerifyLogLine,
  acquireVerifyLock,
  chdir: process.chdir.bind(process),
  cleanupLocalOrphanBuckDaemons,
  cleanupVerifyLegacyPnpmState,
  computeZxTestNodeModulesOut,
  createRegisteredStateCleaner,
  createVerifyPhaseTimer,
  ensureBuckPreludeConfig,
  ensureRepoLocalTmpRoot,
  ensureVerifyPinnedNixpkgs,
  applyNixCacheHealthPolicy,
  exit: process.exit.bind(process),
  initializeVerifyProcessState,
  installVerifySignalHandlers,
  isNonBuildSystemOnlyVerifyTargets,
  killBuckIsolation,
  killProcessGroup,
  logVerifyRevision,
  maybeWriteVerifyTimingSummary,
  parseVerifyArgs,
  parseVerifyExecutionPolicyForArgs,
  prepareVerifySeed,
  prewarmVerifyOnce,
  resolveArtifactToolsRoot: canonicalArtifactToolsRoot,
  recordNixGcPreflight,
  repoRoot,
  resolveRequestedVerifyScope,
  runExplainSelection,
  runFinalOrphanBuckCleanup,
  runMergedCoverageReport,
  runStartupCheck,
  runTemplateManifestCheck,
  runVerifyBuckPasses,
  runVerifyLintPreflight,
  setupLocalVerifyWorkspace,
  shouldPrepareVerifySeedForRequestedTargets,
  startBuckDaemonReaper,
  startBuckWatchdog,
  summarizeVerifyScopeDecision,
  writeVerifyIsoMarker,
};

export type RunVerifyDeps = typeof defaultRunVerifyDeps;
