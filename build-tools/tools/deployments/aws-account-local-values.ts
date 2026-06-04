import path from "node:path";
import { logicalRefPath } from "./aws-account-ref-schemes";
import type { StackInputResolution, StackInputSource } from "./aws-account-input-types";
import {
  PROJECT_LOCAL_CONFIG_PATH,
  projectValueEntryPath,
  readProjectConfig,
} from "./project-config";

export const LOCAL_VALUES_PATH = PROJECT_LOCAL_CONFIG_PATH;

export async function readLocalValue(cwd: string, ref: string) {
  try {
    const loaded = await readProjectConfig(cwd);
    let current: unknown = loaded.config.values;
    for (const part of logicalRefPath(ref).split("/").filter(Boolean)) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return { found: false };
      }
      const obj = current as Record<string, unknown>;
      if (!Object.hasOwn(obj, part)) return { found: false };
      current = obj[part];
    }
    return { found: true, value: current };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { found: false };
    }
    throw new Error(String(error instanceof Error ? error.message : error));
  }
}

export function localSource(cwd: string, ref: string, secret = false): StackInputSource {
  return {
    source: "local-values",
    ref,
    localValuesPath: path.resolve(cwd, LOCAL_VALUES_PATH),
    localValuesEntryPath: projectValueEntryPath(logicalRefPath(ref)),
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
      localValuesEntryPath: projectValueEntryPath(logicalRefPath(localRef)),
      redirectRef,
      redirectSource: resolved.source,
    },
  };
}
