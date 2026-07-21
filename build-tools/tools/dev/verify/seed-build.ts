import * as fsp from "node:fs/promises";
import path from "node:path";
import { artifactNixPolicyArgs } from "../../lib/artifact-nix-policy";

export type VerifySeedBuildMode = "local" | "remote-ready";

async function pathExists(filePath: string): Promise<boolean> {
  return await fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

export async function assertVerifySeedComplete(seedPath: string): Promise<void> {
  for (const required of [".buckconfig", "viberoots/flake.nix"]) {
    if (!(await pathExists(path.join(seedPath, required)))) {
      throw new Error(`verify seed is incomplete: missing ${required} in ${seedPath}`);
    }
  }
  const flakeCandidates = ["flake.nix", ".viberoots/workspace/flake.nix"];
  if (
    !(await Promise.all(flakeCandidates.map((rel) => pathExists(path.join(seedPath, rel))))).some(
      Boolean,
    )
  ) {
    throw new Error(
      `verify seed is incomplete: missing flake.nix or .viberoots/workspace/flake.nix in ${seedPath}`,
    );
  }
}

const evaluationBundleSeedRef =
  /^path:\/nix\/store\/[a-z0-9]{32}-viberoots-evaluation-bundle\?dir=source(?:\/[^#?]+)?#test-seed$/;

export function verifySeedBuildArgs(opts: {
  flakeRef: string;
  mode: VerifySeedBuildMode;
  gcRootPath?: string;
}): string[] {
  if (!evaluationBundleSeedRef.test(opts.flakeRef)) {
    throw new Error("verify seed build requires the canonical immutable evaluation-bundle source");
  }
  const base = [
    "build",
    ...artifactNixPolicyArgs(),
    "--option",
    "eval-cache",
    "false",
    "--no-write-lock-file",
    opts.flakeRef,
    "--accept-flake-config",
  ];
  if (opts.mode === "remote-ready") return [...base, "--no-link", "--print-out-paths"];
  if (!opts.gcRootPath) throw new Error("local verify seed build requires a GC root out-link");
  return [...base, "--out-link", opts.gcRootPath, "--print-out-paths"];
}
