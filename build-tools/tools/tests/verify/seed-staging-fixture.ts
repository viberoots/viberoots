import * as fsp from "node:fs/promises";
import path from "node:path";
import { mktemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

const REQUIRED_STAGE_FILES = [
  "flake.nix",
  ".buckconfig",
  "eslint.config.js",
  path.join(".viberoots", "workspace", "flake.nix"),
  path.join("build-tools", "deployments", "defs.bzl"),
  path.join("build-tools", "tools", "buck", "export-graph.ts"),
  path.join("build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  path.join("viberoots", "eslint.config.js"),
  path.join("viberoots", "build-tools", "deployments", "defs.bzl"),
  path.join("viberoots", "build-tools", "tools", "buck", "export-graph.ts"),
  path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("viberoots", "build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  path.join("viberoots", "flake.nix"),
];

export async function writeRequiredStageFiles(seed: string): Promise<void> {
  for (const rel of REQUIRED_STAGE_FILES) {
    const abs = path.join(seed, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `${rel}\n`, "utf8");
  }
}

export async function initGitSeed(seed: string): Promise<void> {
  await $({ cwd: seed, stdio: "pipe" })`git init -q`;
  await $({ cwd: seed, stdio: "pipe" })`git add .`;
  await $({
    cwd: seed,
    stdio: "pipe",
  })`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed`;
}

export async function withSeedStageRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.VBR_VERIFY_SEED_STAGE_ROOT;
  try {
    process.env.VBR_VERIFY_SEED_STAGE_ROOT = root;
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.VBR_VERIFY_SEED_STAGE_ROOT;
    else process.env.VBR_VERIFY_SEED_STAGE_ROOT = previous;
  }
}

export async function withIsolatedSeedStageRoot<T>(fn: () => Promise<T>): Promise<T> {
  return await withSeedStageRoot(await mktemp("seed-stage-root-"), fn);
}
