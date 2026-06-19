export type VerifySeedBuildMode = "local" | "remote-ready";

export function verifySeedBuildArgs(opts: {
  root: string;
  mode: VerifySeedBuildMode;
  gcRootPath?: string;
}): string[] {
  const flakeRef = `path:${opts.root}/.viberoots/workspace#test-seed`;
  const base = [
    "build",
    "--option",
    "eval-cache",
    "false",
    "--impure",
    flakeRef,
    "--override-input",
    "viberoots",
    `path:${opts.root}/viberoots`,
    "--accept-flake-config",
  ];
  if (opts.mode === "remote-ready") return [...base, "--no-link", "--print-out-paths"];
  if (!opts.gcRootPath) throw new Error("local verify seed build requires a GC root out-link");
  return [...base, "--out-link", opts.gcRootPath, "--print-out-paths"];
}
