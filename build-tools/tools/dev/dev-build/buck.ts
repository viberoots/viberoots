import { withSharedBuckIsolationStartupLock } from "../../lib/shared-buck-isolation-lock";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";

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
}): Promise<void> {
  const buckBin = "buck2";
  process.env.BUCK_ROOT = opts.root;

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
  const baseCmd = `${buckBin} ${quietEmptyGraphGlobalFlags.join(" ")} ${opts.isolationFlags.join(" ")} ${opts.subcmd} ${quietEmptyGraphSubcommandFlags.join(" ")} ${platformFlags.join(
    " ",
  )} ${opts.restArgs.join(" ")}`;
  const ui = createCommandUi({ verbose });
  const useStderrFilter = String(process.env.BUCK_STDERR_FILTER || "").trim() === "1";
  // Default to direct stderr passthrough. Bash process-substitution filters can hang if any child
  // process inherits stderr fds and keeps the substitution pipe open.
  const cmd = useStderrFilter
    ? `${baseCmd} 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*/buckd\\.(stderr|stdout): task [0-9]+ was cancelled|buck2_event_log::writer: Failed to flush log file .*: Broken pipe \\([^)]+\\)' >&2)`
    : baseCmd;

  const isoFlagIndex = opts.isolationFlags.indexOf("--isolation-dir");
  const isolation =
    isoFlagIndex >= 0 && opts.isolationFlags[isoFlagIndex + 1]
      ? String(opts.isolationFlags[isoFlagIndex + 1])
      : "";
  const proc = await withSharedBuckIsolationStartupLock(opts.root, isolation, async () => {
    const buckCmd = $({
      stdio: verbose ? "inherit" : "pipe",
      cwd: opts.root,
      reject: false,
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      },
    })`bash --noprofile --norc -c ${cmd}`;
    return await (verbose ? buckCmd : buckCmd.quiet()).catch((e) => e);
  });
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  if (code !== 0) {
    if (!verbose) printBuckFailure(proc);
    process.exit(code);
  }
  ui.ok("buck", `${opts.subcmd} complete`);
}
