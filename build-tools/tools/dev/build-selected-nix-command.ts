import { stripAnsi } from "./build-selected-helpers";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";

export type SelectedDerivationOutput = "out" | "provenance";

export function selectedNixBuildArgs(opts: {
  flakeRef: string;
  showTrace?: boolean;
  output?: SelectedDerivationOutput;
}): string[] {
  const output = opts.output || "out";
  return [
    "nix",
    "build",
    ...artifactNixPolicyArgs(),
    "--no-write-lock-file",
    "--option",
    "eval-cache",
    "false",
    "--accept-flake-config",
    "--no-link",
    "--print-out-paths",
    ...(opts.showTrace ? ["--show-trace"] : []),
    `${opts.flakeRef}^${output}`,
  ];
}

export function parseSelectedBuildOutPath(stdout: string): string {
  const lines = stripAnsi(String(stdout || ""))
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`expected exactly one selected build out path, got ${lines.length}`);
  }
  return lines[0]!;
}
