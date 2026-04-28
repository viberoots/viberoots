import { withSharedBuckIsolationStartupLock } from "../../lib/shared-buck-isolation-lock";

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
  const baseCmd = `${buckBin} ${opts.isolationFlags.join(" ")} ${opts.subcmd} ${platformFlags.join(
    " ",
  )} ${opts.restArgs.join(" ")}`;
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
    return await $({
      stdio: "inherit",
      cwd: opts.root,
    })`bash --noprofile --norc -c ${cmd}`.catch((e) => e);
  });
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  if (code !== 0) process.exit(code);
}
