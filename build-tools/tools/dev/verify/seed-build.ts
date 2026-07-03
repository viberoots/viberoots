import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export type VerifySeedBuildMode = "local" | "remote-ready";

function seedFlakeRef(root: string): string {
  const hiddenWorkspaceFlake = path.join(root, ".viberoots", "workspace", "flake.nix");
  const flakeRoot = fs.existsSync(hiddenWorkspaceFlake)
    ? path.join(root, ".viberoots", "workspace")
    : root;
  return `path:${flakeRoot}#test-seed`;
}

function viberootsOverrideArgs(root: string, env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    env.VIBEROOTS_FLAKE_INPUT_ROOT || "",
    env.VIBEROOTS_SOURCE_ROOT || "",
    env.VIBEROOTS_ROOT || "",
    path.join(root, "viberoots"),
  ];
  for (const candidate of candidates) {
    const trimmed = String(candidate || "").trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (fs.existsSync(path.join(abs, "flake.nix"))) {
      return ["--override-input", "viberoots", `path:${abs}`];
    }
  }
  return [];
}

export function verifySeedBuildArgs(opts: {
  root: string;
  mode: VerifySeedBuildMode;
  gcRootPath?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const flakeRef = seedFlakeRef(opts.root);
  const overrideArgs = viberootsOverrideArgs(opts.root, opts.env || process.env);
  const base = [
    "build",
    "--option",
    "eval-cache",
    "false",
    "--impure",
    flakeRef,
    ...overrideArgs,
    "--accept-flake-config",
  ];
  if (opts.mode === "remote-ready") return [...base, "--no-link", "--print-out-paths"];
  if (!opts.gcRootPath) throw new Error("local verify seed build requires a GC root out-link");
  return [...base, "--out-link", opts.gcRootPath, "--print-out-paths"];
}
