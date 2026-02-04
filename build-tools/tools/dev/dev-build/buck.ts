import "zx/globals";

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

  const cmd = `${buckBin} ${opts.isolationFlags.join(" ")} ${opts.subcmd} ${platformFlags.join(
    " ",
  )} ${opts.restArgs.join(" ")} 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*/buckd\\.(stderr|stdout): task [0-9]+ was cancelled|buck2_event_log::writer: Failed to flush log file .*: Broken pipe \\([^)]+\\)' >&2)`;

  const proc = await $({
    stdio: "inherit",
    cwd: opts.root,
  })`bash --noprofile --norc -c ${cmd}`.catch((e) => e);
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  if (code !== 0) process.exit(code);
}
