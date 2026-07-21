import fs from "node:fs";
import path from "node:path";
import {
  buildArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../../lib/artifact-environment";
import { DEFAULT_GRAPH_PATH } from "../../../lib/workspace-state-paths";
import { makeFilteredFlakeRef } from "../../../dev/filtered-flake";
import { timeAsync } from "./timing";

type ZxShell = any;
type ZxResult = any;

function activeViberootsRoot(tmp: string): string {
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(tmp, "viberoots"),
    tmp,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const root = path.resolve(candidate);
    if (fs.existsSync(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"))) {
      return root;
    }
    const nested = path.join(root, "viberoots");
    if (fs.existsSync(path.join(nested, "build-tools", "tools", "dev", "zx-init.mjs"))) {
      return nested;
    }
  }
  return path.resolve(tmp);
}

function selectedBuildEnv(args: {
  tmp: string;
  env?: Record<string, string>;
}): Record<string, string> {
  const { env } = args;
  return {
    ...withoutArtifactEnvironmentInfluence(process.env),
    ...(env || {}),
  };
}

export async function exportGraphInTemp(args: {
  tmp: string;
  $: ZxShell;
  env?: Record<string, string>;
  stdio?: "inherit" | "pipe";
}): Promise<ZxResult> {
  const { tmp, $, env, stdio = "inherit" } = args;
  const root = activeViberootsRoot(tmp);
  const nodeBin = path.join(canonicalArtifactToolsRoot(tmp), "bin", "node");
  return await timeAsync("selectedBuild exportGraphInTemp", async () => {
    return await $({
      cwd: tmp,
      stdio,
      env: selectedBuildEnv({ tmp, env }),
    })`${nodeBin} --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import ${path.join(root, "build-tools", "tools", "dev", "zx-init.mjs")} ${path.join(root, "build-tools", "tools", "buck", "export-graph.ts")} --out ${DEFAULT_GRAPH_PATH}`;
  });
}

export async function runBuildSelected(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  env?: Record<string, string>;
  stdio?: "inherit" | "pipe";
  reject?: boolean;
  nothrow?: boolean;
}): Promise<ZxResult> {
  const { tmp, $, target, env, stdio = "pipe", reject = false, nothrow = true } = args;
  const root = activeViberootsRoot(tmp);
  const nodeBin = path.join(canonicalArtifactToolsRoot(tmp), "bin", "node");
  return await timeAsync("selectedBuild runBuildSelected", async () => {
    return await $({
      cwd: tmp,
      stdio,
      reject,
      nothrow,
      env: selectedBuildEnv({ tmp, env }),
    })`${nodeBin} --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import ${path.join(root, "build-tools", "tools", "dev", "zx-init.mjs")} ${path.join(root, "build-tools", "tools", "dev", "build-selected.ts")} --artifact-workspace-root=${tmp} --target ${target}`;
  });
}

export async function buildSelectedOutPath(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  env?: Record<string, string>;
}): Promise<string> {
  const { tmp, $, target, env } = args;
  const res = await runBuildSelected({ tmp, $, target, env, stdio: "pipe" });
  return await timeAsync("selectedBuild parseOutPath", async () => {
    if (Number(res.exitCode || 0) !== 0) {
      const combined = `${String(res.stdout || "")}\n${String(res.stderr || "")}`.trim();
      throw new Error(`build-selected.ts failed for ${target}\n${combined}`);
    }
    const outPath =
      String(res.stdout || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) throw new Error(`no out path from build-selected.ts for ${target}`);
    return outPath;
  });
}

export async function runFilteredFlakeAttr(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  attr: string;
  coverage?: boolean;
  env?: Record<string, string>;
  stdio?: "inherit" | "pipe";
  nothrow?: boolean;
}): Promise<ZxResult> {
  const { tmp, $, target, attr, coverage, env, stdio = "pipe", nothrow = false } = args;
  const artifactToolsRoot = canonicalArtifactToolsRoot(
    tmp,
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const artifactEnv = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    mode: "local",
    stateRoot: path.join(tmp, "buck-out", "tmp", "filtered-attr-environment"),
    workspaceRoot: tmp,
    artifactToolsRoot,
    internal: {
      WORKSPACE_ROOT: tmp,
      BUCK_TARGET: target,
      ...(env?.NIX_PNPM_ALLOW_GENERATE
        ? { NIX_PNPM_ALLOW_GENERATE: env.NIX_PNPM_ALLOW_GENERATE }
        : {}),
    },
  });
  const bundle = await makeFilteredFlakeRef({
    workspaceRoot: tmp,
    attr,
    target,
    logPrefix: "[filtered-test-attr]",
    classification: "local-development",
    env: artifactEnv,
    selectorEnv: {},
    coverage,
  });
  try {
    return await $({ cwd: tmp, env: artifactEnv, stdio, nothrow })`${path.join(
      artifactToolsRoot,
      "bin",
      "nix",
    )} build ${bundle.flakeRef} --no-link --no-write-lock-file --accept-flake-config --builders "" --print-out-paths`;
  } finally {
    await bundle.cleanup();
  }
}
