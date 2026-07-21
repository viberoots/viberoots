import { withSharedBuckIsolationStartupLock } from "../../lib/shared-buck-isolation-lock";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import {
  encodeEvaluationBundleDevOverrides,
  type DevOverrideValues,
} from "../evaluation-bundle-selectors";

function assertNoUserDevOverrideConfig(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "");
    const value = token === "--config" ? String(args[index + 1] || "") : token.slice(9);
    if (
      (token === "--config" || token.startsWith("--config=")) &&
      value.startsWith("viberoots.dev_overrides=")
    ) {
      throw new Error("viberoots.dev_overrides is reserved for canonical ingress transport");
    }
  }
}
import {
  assertNoArtifactSelectorInjection,
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import path from "node:path";

function outputTail(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const max = 20_000;
  return text.length > max ? text.slice(text.length - max) : text;
}

function printBuckFailure(proc: unknown): void {
  const out = proc as {
    stdout?: unknown;
    stderr?: unknown;
    cause?: { stdout?: unknown; stderr?: unknown };
  };
  const details = [out.stderr, out.stdout, out.cause?.stderr, out.cause?.stdout]
    .map(outputTail)
    .filter(Boolean)
    .join("\n");
  process.stderr.write("[dev-build] buck failed\n");
  if (details) process.stderr.write(`${details}\n`);
}

export async function runBuckCommand(opts: {
  root: string;
  subcmd: string;
  restArgs: string[];
  isolationFlags: string[];
  devOverrides: DevOverrideValues;
  artifactToolsRoot: string;
}): Promise<void> {
  assertNoUserDevOverrideConfig(opts.restArgs);
  assertNoArtifactSelectorInjection(process.env, {
    allow: ["BUCK_GRAPH_JSON", "VBR_ARTIFACT_TOOLS_ROOT"],
  });
  const hasUserPlatform =
    opts.restArgs.includes("--target-platforms") || opts.restArgs.includes("--user-platform");
  const platformFlags = hasUserPlatform ? [] : ["--target-platforms", "prelude//platforms:default"];
  const verbose = isVbrVerbose();
  const quietEmptyGraph =
    !verbose &&
    String(process.env.DEVBUILD_EMPTY_GRAPH || "").trim() === "1" &&
    !String(process.env.BUCK_VERBOSE || "").trim();
  const quietEmptyGraphGlobalFlags = quietEmptyGraph ? ["-v", "0"] : [];
  const quietEmptyGraphSubcommandFlags = quietEmptyGraph ? ["--console", "none"] : [];
  const ui = createCommandUi({ verbose });
  const useStderrFilter = String(process.env.BUCK_STDERR_FILTER || "").trim() === "1";
  const isoFlagIndex = opts.isolationFlags.indexOf("--isolation-dir");
  const isolation =
    isoFlagIndex >= 0 && opts.isolationFlags[isoFlagIndex + 1]
      ? String(opts.isolationFlags[isoFlagIndex + 1])
      : "";
  const artifactEnv = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(opts.root, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: opts.root,
    artifactToolsRoot: opts.artifactToolsRoot,
    internal: {
      BUCK_ROOT: opts.root,
      BUCK_GRAPH_JSON: path.join(opts.root, DEFAULT_GRAPH_PATH),
      BUCK_ISOLATION_DIR: isolation,
      BUCK2_REAL_HOME: path.join(opts.root, "buck-out", "tmp", "artifact-environment", "home"),
      WORKSPACE_ROOT: opts.root,
    },
  });
  const buckBin = ensureNixStoreToolPathSync("buck2", artifactEnv);
  const bashBin = ensureNixStoreToolPathSync("bash", artifactEnv);
  const encodedDevOverrides = encodeEvaluationBundleDevOverrides(opts.devOverrides);
  const devOverrideConfigFlags = encodedDevOverrides
    ? ["--config", `viberoots.dev_overrides=${encodedDevOverrides}`]
    : [];
  const baseCmd = `${buckBin} ${quietEmptyGraphGlobalFlags.join(" ")} ${opts.isolationFlags.join(" ")} ${devOverrideConfigFlags.join(" ")} ${opts.subcmd} ${quietEmptyGraphSubcommandFlags.join(" ")} ${platformFlags.join(
    " ",
  )} ${opts.restArgs.join(" ")}`;
  // Default to direct stderr passthrough. Bash process-substitution filters can hang if any child
  // process inherits stderr fds and keeps the substitution pipe open.
  const cmd = useStderrFilter
    ? `${baseCmd} 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*/buckd\\.(stderr|stdout): task [0-9]+ was cancelled|buck2_event_log::writer: Failed to flush log file .*: Broken pipe \\([^)]+\\)' >&2)`
    : baseCmd;
  const proc = await withSharedBuckIsolationStartupLock(opts.root, isolation, async () => {
    const buckCmd = $({
      stdio: verbose ? "inherit" : "pipe",
      cwd: opts.root,
      reject: false,
      env: {
        ...artifactEnv,
      },
    })`${bashBin} --noprofile --norc -c ${cmd}`;
    return await (verbose ? buckCmd : buckCmd.quiet()).catch((e) => e);
  });
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  if (code !== 0) {
    if (!verbose) printBuckFailure(proc);
    process.exit(code);
  }
  if (!verbose && opts.restArgs.includes("--show-output")) {
    process.stdout.write(String(proc.stdout || ""));
  }
  ui.ok("buck", `${opts.subcmd} complete`);
}
