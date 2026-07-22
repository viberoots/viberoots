import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { isVbrVerbose } from "../../lib/command-ui";
import { runNodeWithZx } from "../../lib/node-run";
import { buildToolsRoot, buildToolPath } from "../dev-build/paths";

type PreflightOptions = {
  changedOnly?: boolean;
  zxNodeModulesOut?: string | null;
};

function verbose(): boolean {
  return isVbrVerbose();
}

function envWithZxNodeModules(zxNodeModulesOut?: string | null): NodeJS.ProcessEnv {
  const outPath = String(zxNodeModulesOut || "").trim();
  if (!outPath) return process.env;
  const nodeModules = path.join(outPath, "node_modules");
  return {
    ...process.env,
    ZX_TEST_NODE_MODULES_OUT: outPath,
    NODE_PATH: [nodeModules, process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter),
  };
}

function printCapturedFailure(error: unknown): void {
  const err = error as { stdout?: unknown; stderr?: unknown };
  const details = [err?.stderr, err?.stdout]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (details) process.stderr.write(`${details}\n`);
}

async function firstExisting(root: string, relCandidates: string[]): Promise<string> {
  for (const rel of relCandidates) {
    try {
      await fsp.access(path.join(root, rel));
      return rel;
    } catch {}
  }
  return relCandidates[0] || "";
}

async function runScript(
  root: string,
  zxInitPath: string,
  script: string,
  args: string[],
  opts: PreflightOptions,
  failure: string,
): Promise<void> {
  try {
    await runNodeWithZx({
      cwd: root,
      script: buildToolPath(root, script),
      args,
      zxInitPath,
      env: envWithZxNodeModules(opts.zxNodeModulesOut),
      stdio: verbose() ? "inherit" : "pipe",
    });
  } catch (error) {
    printCapturedFailure(error);
    process.stderr.write(failure);
    process.exit(2);
  }
}

export function shouldRunBuildSystemPolicy(root: string): boolean {
  const toolsRoot = fs.realpathSync.native(path.resolve(buildToolsRoot(root)));
  const workspaceRoot = fs.realpathSync.native(path.resolve(root));
  return (
    toolsRoot === path.join(workspaceRoot, "build-tools") ||
    toolsRoot.startsWith(`${workspaceRoot}${path.sep}`)
  );
}

export async function runVerifyLanguagesPreflight(
  root: string,
  zxInitPath: string,
  opts: PreflightOptions = {},
): Promise<void> {
  if (verbose()) {
    process.stderr.write("[verify] language graduation preflight: validating langs.json\n");
  }
  await runScript(
    root,
    zxInitPath,
    "tools/dev/validate-langs.ts",
    [],
    opts,
    "error: language graduation preflight failed; fix langs.json or its graph-proven reproducibility coverage and re-run 'v'\n",
  );
}

export async function runVerifyStaleNamesPreflight(
  root: string,
  zxInitPath: string,
  opts: PreflightOptions = {},
): Promise<void> {
  if (verbose()) {
    process.stderr.write(
      "[verify] stale-names preflight: scanning active source for stale names\n",
    );
  }
  await runScript(
    root,
    zxInitPath,
    "tools/dev/stale-names-lint.ts",
    ["--full"],
    opts,
    "error: stale-names preflight failed; fix stale repo names, plan numbers, or migration labels and re-run 'v'\n",
  );
}

export async function runVerifyFileSizePreflight(
  root: string,
  zxInitPath: string,
  opts: PreflightOptions = {},
): Promise<void> {
  const args = ["--scope=source", "--fail=true"];
  if (opts.changedOnly) args.push("--changed-only");
  if (verbose()) {
    process.stderr.write(
      opts.changedOnly
        ? "[verify] file-size preflight: running changed-file source file-size gate\n"
        : "[verify] file-size preflight: running strict repo-owned file-size gate\n",
    );
  }
  await runScript(
    root,
    zxInitPath,
    "tools/dev/file-size-lint.ts",
    args,
    opts,
    "error: file-size preflight failed; split oversized files and re-run 'v'\n",
  );
}

export async function runVerifyNixGapsPolicyPreflight(
  root: string,
  zxInitPath: string,
  opts: PreflightOptions = {},
): Promise<void> {
  const starlarkApi = await firstExisting(root, [
    "docs/handbook/starlark-api.md",
    "viberoots/docs/handbook/starlark-api.md",
  ]);
  const nixGaps = await firstExisting(root, [
    "docs/handbook/nix-gaps.md",
    "viberoots/docs/handbook/nix-gaps.md",
  ]);
  const exceptions = await firstExisting(root, [
    "docs/handbook/nix-gaps-exceptions.json",
    "viberoots/docs/handbook/nix-gaps-exceptions.json",
  ]);
  const commandSitePolicy = await firstExisting(root, [
    "docs/handbook/nix-command-site-policy.json",
    "viberoots/docs/handbook/nix-command-site-policy.json",
  ]);
  if (verbose()) {
    process.stderr.write(
      "[verify] nix-gaps policy preflight: running inventory + exception checks\n",
    );
  }
  await runScript(
    root,
    zxInitPath,
    "tools/dev/nix-gaps-inventory-check.ts",
    [
      "--starlark-api",
      starlarkApi,
      "--nix-gaps",
      nixGaps,
      "--exceptions",
      exceptions,
      "--command-site-policy",
      commandSitePolicy,
    ],
    opts,
    "error: nix-gaps policy preflight failed; update docs/policy files and re-run 'v'\n",
  );
}
