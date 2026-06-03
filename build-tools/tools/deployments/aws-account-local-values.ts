import * as fsp from "node:fs/promises";
import path from "node:path";
import { logicalRefPath } from "./aws-account-ref-schemes";
import type { StackInputResolution, StackInputSource } from "./aws-account-input-types";

export const LOCAL_VALUES_PATH = "config/sprinkleref/local/values.json";

export async function readLocalValue(cwd: string, ref: string) {
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `malformed local SprinkleRef values: ${LOCAL_VALUES_PATH} root must be an object`,
    );
  }
  const root = parsed as Record<string, unknown>;
  let current: unknown = root.values;
  for (const part of logicalRefPath(ref).split("/").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return { found: false };
    const obj = current as Record<string, unknown>;
    if (!Object.hasOwn(obj, part)) return { found: false };
    current = obj[part];
  }
  return { found: true, value: current };
}

export function localSource(cwd: string, ref: string, secret = false): StackInputSource {
  return {
    source: "local-values",
    ref,
    localValuesPath: path.resolve(cwd, LOCAL_VALUES_PATH),
    localValuesEntryPath: localValueEntryPath(ref),
    valuePrinted: !secret,
  };
}

export function localRedirectSource(cwd: string, localRef: string, resolved: StackInputResolution) {
  const redirectRef = resolved.source.ref || resolved.ref;
  return {
    ...resolved,
    ref: localRef,
    source: {
      ...resolved.source,
      ref: localRef,
      localValuesPath: path.resolve(cwd, LOCAL_VALUES_PATH),
      localValuesEntryPath: localValueEntryPath(localRef),
      redirectRef,
      redirectSource: resolved.source,
    },
  };
}

function localValueEntryPath(ref: string): string {
  return `values.${logicalRefPath(ref).split("/").filter(Boolean).join(".")}`;
}
