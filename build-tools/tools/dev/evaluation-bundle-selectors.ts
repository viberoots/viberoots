import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs";
import { copyTree, type CopyFileCloneMode } from "../lib/copy-tree";
import { inventoryBundleSource, type BundleFile } from "./evaluation-bundle-manifest";

type OverrideMap = Record<string, string>;

const rejectedOverrideSegments = new Set([
  ".aws",
  ".cache",
  ".direnv",
  ".env",
  ".git-credentials",
  ".git",
  ".netrc",
  ".next",
  ".pnpm-store",
  ".pypirc",
  ".ssh",
  ".vite",
  ".wasm-producer",
  "buck-out",
  "coverage",
  "dist",
  "node_modules",
]);
const MAX_OVERRIDE_FILES = 50_000;
const MAX_OVERRIDE_BYTES = 512 * 1024 * 1024;

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function reviewedOverrideFiles(source: string, bundleRoot: string): Promise<BundleFile[]> {
  if (containsPath(source, bundleRoot)) {
    throw new Error(
      `evaluation bundle override source contains the bundle staging root: ${source}`,
    );
  }
  const broadRoots = await Promise.all(
    [path.parse(source).root, os.homedir(), os.tmpdir()].map(
      async (candidate) => await fsp.realpath(candidate).catch(() => path.resolve(candidate)),
    ),
  );
  if (broadRoots.includes(source)) {
    throw new Error(`evaluation bundle override source is too broad: ${source}`);
  }
  const pending = [source];
  let fileCount = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const dir = pending.pop()!;
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(source, absolute).split(path.sep).join("/");
      if (rejectedOverrideSegments.has(entry.name) || entry.name.startsWith(".env.")) {
        throw new Error(`evaluation bundle override source contains excluded path: ${relative}`);
      }
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      fileCount += 1;
      if (fileCount > MAX_OVERRIDE_FILES) {
        throw new Error(
          `evaluation bundle override source exceeds ${MAX_OVERRIDE_FILES} files: ${source}`,
        );
      }
      if (entry.isFile()) bytes += (await fsp.lstat(absolute)).size;
      if (bytes > MAX_OVERRIDE_BYTES) {
        throw new Error(`evaluation bundle override source exceeds 512 MiB: ${source}`);
      }
    }
  }
  return await inventoryBundleSource(source);
}

function parseOverrideMap(envName: string, raw: string): OverrideMap {
  if (!raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ${envName}: expected a JSON object`, { cause: error });
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`invalid ${envName}: expected a JSON object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key, source]) => !key || typeof source !== "string" || !source.trim())) {
    throw new Error(`invalid ${envName}: keys and source paths must be non-empty strings`);
  }
  return Object.fromEntries(entries.map(([key, source]) => [key, path.resolve(String(source))]));
}

export function evaluationBundleHasLanguageOverrides(env: NodeJS.ProcessEnv): boolean {
  return allDevOverrideEnvNames().some(
    (envName) => Object.keys(parseOverrideMap(envName, String(env[envName] || ""))).length > 0,
  );
}

export async function captureEvaluationBundleSelectors(opts: {
  bundleRoot: string;
  env: NodeJS.ProcessEnv;
  copyMode: CopyFileCloneMode;
}): Promise<{
  languageOverrides: Record<string, OverrideMap>;
  onlyCpp: boolean;
  overrideFiles: BundleFile[];
  wasmBackend: string;
}> {
  const wasmBackend = String(opts.env.WEB_WASM_BACKEND || "").trim();
  if (wasmBackend !== "" && wasmBackend !== "wasi_single") {
    throw new Error(`invalid WEB_WASM_BACKEND for evaluation bundle: ${wasmBackend}`);
  }
  const languageOverrides: Record<string, OverrideMap> = {};
  const overrideFiles: BundleFile[] = [];
  const bundleRoot = await fsp.realpath(opts.bundleRoot);
  for (const envName of allDevOverrideEnvNames()) {
    const overrides = parseOverrideMap(envName, String(opts.env[envName] || ""));
    const captured: OverrideMap = {};
    for (const [index, key] of Object.keys(overrides).sort().entries()) {
      const source = await fsp.realpath(overrides[key]!).catch((error) => {
        throw new Error(`evaluation bundle override source is unavailable: ${envName} ${key}`, {
          cause: error,
        });
      });
      const stat = await fsp.lstat(source).catch((error) => {
        throw new Error(`evaluation bundle override source is unavailable: ${envName} ${key}`, {
          cause: error,
        });
      });
      if (!stat.isDirectory()) {
        throw new Error(`evaluation bundle override source must be a directory: ${envName} ${key}`);
      }
      await reviewedOverrideFiles(source, bundleRoot);
      const relative = path.posix.join("overrides", envName, String(index).padStart(4, "0"));
      const destination = path.join(bundleRoot, ...relative.split("/"));
      if (containsPath(source, destination)) {
        throw new Error(`evaluation bundle override source contains its destination: ${source}`);
      }
      await copyTree(source, destination, { cloneMode: opts.copyMode, force: true });
      for (const file of await inventoryBundleSource(destination)) {
        overrideFiles.push({ ...file, path: path.posix.join(relative, file.path) });
      }
      captured[key] = relative;
    }
    languageOverrides[envName] = captured;
  }
  return {
    languageOverrides,
    onlyCpp: String(opts.env.PLANNER_ONLY_CPP || "").trim() !== "",
    overrideFiles: overrideFiles.sort((left, right) => left.path.localeCompare(right.path)),
    wasmBackend,
  };
}
