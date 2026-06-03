import * as fsp from "node:fs/promises";
import path from "node:path";
import { assertBackendNeutralSecretRef, resolveSprinkleRefBackend } from "./sprinkleref-config";
import { readSelectedSprinkleRefConfig } from "./sprinkleref-config-select";
import { createSprinkleRefStore } from "./sprinkleref-store";

export const LOCAL_VALUES_PATH = "config/sprinkleref/local/values.json";

export type StackInputSource = {
  source: "cli" | "inline" | "default" | "local-values" | "sprinkleref" | "env" | "missing";
  ref?: string;
  category?: string;
  env?: string;
  localValuesPath?: string;
  backend?: string;
  valuePrinted: boolean;
};

export type StackInputResolution = {
  value?: string;
  ref?: string;
  category?: string;
  source: StackInputSource;
  error?: string;
};

export function parseStackField(
  file: Record<string, unknown>,
  key: string,
  opts: { secret?: boolean; required?: boolean } = {},
): StackInputResolution {
  if (!Object.hasOwn(file, key)) return missingSource(key, opts);
  const raw = file[key];
  if (typeof raw === "string") {
    if (opts.secret && raw.trim()) throw new Error(`${key} must not be a plaintext value`);
    return raw.trim()
      ? { value: raw.trim(), source: inlineSource(opts.secret) }
      : missingSource(key, opts);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${key} must be a scalar, { "value": ... }, or { "ref": "secret://..." }`);
  }
  const obj = raw as Record<string, unknown>;
  if (Object.hasOwn(obj, "value") && Object.hasOwn(obj, "ref")) {
    throw new Error(`${key} must not contain both value and ref`);
  }
  if (Object.hasOwn(obj, "value")) {
    if (opts.secret) throw new Error(`${key} must not be a plaintext value`);
    const value = obj.value;
    if (typeof value !== "string" || !value.trim()) return missingSource(key, opts);
    return { value: value.trim(), source: inlineSource(opts.secret) };
  }
  if (!Object.hasOwn(obj, "ref")) throw new Error(`${key} object must contain value or ref`);
  const ref = stringMember(obj, "ref");
  const category = stringMember(obj, "category");
  if (!ref) return missingSource(key, opts);
  assertSecretRef(key, ref);
  return { ref, category, source: { source: "missing", ref, category, valuePrinted: false } };
}

export async function resolveStackRef(
  cwd: string,
  ref: string,
  opts: { category?: string; secret?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<StackInputResolution> {
  assertSecretRef("stack ref", ref);
  return await resolveRef(cwd, ref, { ...opts, cwd }, new Set());
}

export function cliSource(secret = false): StackInputSource {
  return { source: "cli", valuePrinted: !secret };
}

export function defaultSource(): StackInputSource {
  return { source: "default", valuePrinted: true };
}

function inlineSource(secret = false): StackInputSource {
  return { source: "inline", valuePrinted: !secret };
}

function missingSource(
  key: string,
  opts: { secret?: boolean; required?: boolean },
): StackInputResolution {
  if (opts.required) throw new Error(`${key} is required`);
  return { source: { source: "missing", valuePrinted: !opts.secret } };
}

async function resolveRef(
  cwd: string,
  ref: string,
  opts: { category?: string; secret?: boolean; env?: NodeJS.ProcessEnv; cwd: string },
  seen: Set<string>,
): Promise<StackInputResolution> {
  const cycleKey = `${opts.category || ""}:${ref}`;
  if (seen.has(cycleKey)) throw new Error(`local SprinkleRef redirect cycle for ${ref}`);
  seen.add(cycleKey);
  const local = await readLocalValue(cwd, ref);
  if (local.found) return await resolveLocalValue(cwd, ref, local.value, opts, seen);
  return await resolveRemoteRef(ref, opts);
}

async function resolveLocalValue(
  cwd: string,
  ref: string,
  raw: unknown,
  opts: { category?: string; secret?: boolean; env?: NodeJS.ProcessEnv; cwd: string },
  seen: Set<string>,
): Promise<StackInputResolution> {
  if (typeof raw === "string") {
    if (opts.secret) throw new Error(`${ref} must not be plaintext in ${LOCAL_VALUES_PATH}`);
    return {
      value: raw.trim() || undefined,
      source: localSource(cwd, ref, opts.secret),
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${ref} local value must be a string, { "value": ... }, or redirect object`);
  }
  const obj = raw as Record<string, unknown>;
  if (Object.hasOwn(obj, "value") && Object.hasOwn(obj, "ref")) {
    throw new Error(`${ref} local value must not contain both value and ref`);
  }
  if (Object.hasOwn(obj, "value")) {
    if (opts.secret) throw new Error(`${ref} must not be plaintext in ${LOCAL_VALUES_PATH}`);
    const value = obj.value;
    if (typeof value !== "string") throw new Error(`${ref} local value.value must be a string`);
    return { value: value.trim() || undefined, source: localSource(cwd, ref, opts.secret) };
  }
  const targetRef = stringMember(obj, "ref");
  if (!targetRef) throw new Error(`${ref} local redirect requires ref`);
  assertSecretRef("local redirect", targetRef);
  const category = stringMember(obj, "category");
  if (category) return await resolveRemoteRef(targetRef, { ...opts, category });
  if (targetRef !== ref) return await resolveRef(cwd, targetRef, opts, seen);
  return await resolveRemoteRef(targetRef, opts);
}

async function resolveRemoteRef(
  ref: string,
  opts: { category?: string; secret?: boolean; env?: NodeJS.ProcessEnv; cwd: string },
): Promise<StackInputResolution> {
  try {
    const config = await readSelectedSprinkleRefConfig(await selectedConfigPath(opts), opts.env);
    const resolved = resolveSprinkleRefBackend(config, opts.category);
    const store = createSprinkleRefStore(resolved.backend, {
      env: opts.env,
      resolverConfig: config,
      platform: process.platform,
    });
    const value = await store.read(ref);
    return {
      value: value || undefined,
      ref,
      category: resolved.category,
      source: {
        source: value ? "sprinkleref" : "missing",
        ref,
        category: resolved.category,
        backend: store.describe(),
        valuePrinted: !opts.secret,
      },
      error: value ? undefined : `${ref} is missing in SprinkleRef category ${resolved.category}`,
    };
  } catch (error) {
    return {
      ref,
      category: opts.category,
      source: { source: "missing", ref, category: opts.category, valuePrinted: false },
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

async function selectedConfigPath(opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  if (opts.env?.SPRINKLEREF_CONFIG) return "";
  for (const rel of [
    "config/sprinkleref/selected.json",
    "config/sprinkleref/selected.local.json",
  ]) {
    const candidate = path.resolve(opts.cwd, rel);
    if ((await fsp.stat(candidate).catch(() => undefined))?.isFile()) return candidate;
  }
  return "";
}

async function readLocalValue(
  cwd: string,
  ref: string,
): Promise<{ found: boolean; value?: unknown }> {
  const file = path.resolve(cwd, LOCAL_VALUES_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { found: false };
    }
    throw new Error(`invalid local SprinkleRef values JSON: ${LOCAL_VALUES_PATH}`);
  }
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  let current: unknown = root.values;
  for (const part of refPathParts(ref)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return { found: false };
    const obj = current as Record<string, unknown>;
    if (!Object.hasOwn(obj, part)) return { found: false };
    current = obj[part];
  }
  return { found: true, value: current };
}

function refPathParts(ref: string): string[] {
  return ref.slice("secret://".length).split("/").filter(Boolean);
}

function localSource(cwd: string, ref: string, secret = false): StackInputSource {
  return {
    source: "local-values",
    ref,
    localValuesPath: path.resolve(cwd, LOCAL_VALUES_PATH),
    valuePrinted: !secret,
  };
}

function stringMember(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertSecretRef(key: string, ref: string): void {
  if (!ref.startsWith("secret://")) throw new Error(`${key} ref must use secret://`);
  assertBackendNeutralSecretRef(ref);
}
