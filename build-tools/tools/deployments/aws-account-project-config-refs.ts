import { assertStackRef, type StackRefOptions } from "./aws-account-ref-schemes";
import type { StackInputResolution } from "./aws-account-input-types";
import { localRedirectSource, localSource, readLocalValue } from "./aws-account-local-values";

type RefResolutionOpts = StackRefOptions & { cwd: string };

export async function resolveProjectConfigRef(
  cwd: string,
  ref: string,
  opts: RefResolutionOpts,
  seen: Set<string>,
  resolveRef: (
    cwd: string,
    ref: string,
    opts: RefResolutionOpts,
    seen: Set<string>,
  ) => Promise<StackInputResolution>,
): Promise<StackInputResolution> {
  const cycleKey = `config:${ref}`;
  if (seen.has(cycleKey)) throw new Error(`project config redirect cycle for ${ref}`);
  seen.add(cycleKey);
  const local = await readLocalValue(cwd, ref);
  if (local.found) {
    return await resolveProjectConfigValue(cwd, ref, local.value, opts, seen, resolveRef);
  }
  return {
    ref,
    source: { source: "missing", ref, valuePrinted: true },
    error: `${ref} is missing in project config values`,
  };
}

async function resolveProjectConfigValue(
  cwd: string,
  ref: string,
  raw: unknown,
  opts: RefResolutionOpts,
  seen: Set<string>,
  resolveRef: (
    cwd: string,
    ref: string,
    opts: RefResolutionOpts,
    seen: Set<string>,
  ) => Promise<StackInputResolution>,
): Promise<StackInputResolution> {
  if (typeof raw === "string") {
    return { value: raw.trim() || undefined, source: localSource(cwd, ref, opts.secret) };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${ref} local value must be a string, { "value": ... }, or redirect object`);
  }
  const obj = raw as Record<string, unknown>;
  if (Object.hasOwn(obj, "value") && Object.hasOwn(obj, "ref")) {
    throw new Error(`${ref} local value must not contain both value and ref`);
  }
  if (Object.hasOwn(obj, "value")) {
    const value = obj.value;
    if (typeof value !== "string") throw new Error(`${ref} local value.value must be a string`);
    return { value: value.trim() || undefined, source: localSource(cwd, ref, opts.secret) };
  }
  const targetRef = stringMember(obj, "ref");
  if (!targetRef) throw new Error(`${ref} local redirect requires ref`);
  assertStackRef("local redirect", targetRef, Boolean(opts.secret));
  const category = optionalStringMember(obj, "category", `${ref} local redirect category`);
  const resolved = await resolveRef(cwd, targetRef, { ...opts, category }, seen);
  return localRedirectSource(cwd, ref, resolved);
}

function stringMember(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringMember(obj: Record<string, unknown>, key: string, label: string) {
  if (!Object.hasOwn(obj, key)) return undefined;
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a string`);
  return value.trim();
}
