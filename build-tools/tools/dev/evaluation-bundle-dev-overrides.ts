import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyTree, type CopyFileCloneMode } from "../lib/copy-tree";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs";
import { inventoryBundleSource, type BundleFile } from "./evaluation-bundle-manifest";

export type OverrideMap = Record<string, string>;
export type DevOverrideValues = Record<string, string>;
const DEV_OVERRIDES_FLAG = "--dev-overrides";

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

async function reviewedOverrideFiles(source: string, bundleRoot: string): Promise<void> {
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

export function normalizedDevOverrideValues(values: NodeJS.ProcessEnv): DevOverrideValues {
  const normalized: DevOverrideValues = {};
  for (const envName of allDevOverrideEnvNames()) {
    const raw = String(values[envName] || "").trim();
    if (raw) normalized[envName] = JSON.stringify(parseOverrideMap(envName, raw));
  }
  return normalized;
}

export function encodeEvaluationBundleDevOverrides(values: NodeJS.ProcessEnv): string {
  const normalized = normalizedDevOverrideValues(values);
  return Object.keys(normalized).length === 0
    ? ""
    : Buffer.from(JSON.stringify(normalized), "utf8").toString("hex");
}

export function evaluationBundleDevOverrides(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): DevOverrideValues {
  const encoded: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === DEV_OVERRIDES_FLAG) encoded.push(String(argv[++index] || "").trim());
    else if (token.startsWith(`${DEV_OVERRIDES_FLAG}=`)) {
      encoded.push(token.slice(DEV_OVERRIDES_FLAG.length + 1).trim());
    }
  }
  if (encoded.length > 1 || encoded.some((value) => !value)) {
    throw new Error("duplicate or empty canonical dev override transport");
  }
  const fromEnv = normalizedDevOverrideValues(env);
  if (encoded.length > 0 && Object.keys(fromEnv).length > 0) {
    throw new Error("conflicting dev override environment and canonical argv transport");
  }
  if (encoded.length === 0) return fromEnv;
  if (!/^(?:[0-9a-f]{2})+$/u.test(encoded[0]!)) {
    throw new Error("invalid canonical dev override transport encoding");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded[0]!, "hex").toString("utf8"));
  } catch (error) {
    throw new Error("invalid canonical dev override transport", { cause: error });
  }
  if (!decoded || Array.isArray(decoded) || typeof decoded !== "object") {
    throw new Error("invalid canonical dev override transport: expected an object");
  }
  const allowed = new Set(allDevOverrideEnvNames());
  const entries = Object.entries(decoded as Record<string, unknown>);
  if (
    entries.some(
      ([name, value]) => !allowed.has(name) || typeof value !== "string" || !value.trim(),
    )
  ) {
    throw new Error("invalid canonical dev override transport keys or values");
  }
  return normalizedDevOverrideValues(Object.fromEntries(entries) as NodeJS.ProcessEnv);
}

export function canonicalDevOverrideArg(values: NodeJS.ProcessEnv): string {
  const encoded = encodeEvaluationBundleDevOverrides(values);
  return encoded ? `${DEV_OVERRIDES_FLAG}=${encoded}` : "";
}

export function withoutCanonicalDevOverrideArgs(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === DEV_OVERRIDES_FLAG) index += 1;
    else if (!token.startsWith(`${DEV_OVERRIDES_FLAG}=`)) out.push(token);
  }
  return out;
}

export function evaluationBundleHasLanguageOverrides(values: NodeJS.ProcessEnv): boolean {
  return allDevOverrideEnvNames().some(
    (name) => Object.keys(parseOverrideMap(name, String(values[name] || ""))).length > 0,
  );
}

export async function captureLanguageOverrides(opts: {
  bundleRoot: string;
  devOverrides: DevOverrideValues;
  copyMode: CopyFileCloneMode;
}): Promise<{ languageOverrides: Record<string, OverrideMap>; overrideFiles: BundleFile[] }> {
  const languageOverrides: Record<string, OverrideMap> = {};
  const overrideFiles: BundleFile[] = [];
  for (const envName of allDevOverrideEnvNames()) {
    const overrides = parseOverrideMap(envName, String(opts.devOverrides[envName] || ""));
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
      await reviewedOverrideFiles(source, opts.bundleRoot);
      const relative = path.posix.join("overrides", envName, String(index).padStart(4, "0"));
      const destination = path.join(opts.bundleRoot, ...relative.split("/"));
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
  return { languageOverrides, overrideFiles };
}
