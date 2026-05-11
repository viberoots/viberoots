#!/usr/bin/env zx-wrapper

export type KindValue =
  | "addon"
  | "app"
  | "bin"
  | "bundle"
  | "carchive"
  | "deployment"
  | "gen"
  | "headers"
  | "lib"
  | "migration-bundle"
  | "migrations"
  | "packaging"
  | "pyext"
  | "pyext_wasm"
  | "probe"
  | "test"
  | "wasm";

export const ALLOWED_KIND_VALUES: ReadonlyArray<KindValue> = [
  "addon",
  "app",
  "bin",
  "bundle",
  "carchive",
  "deployment",
  "gen",
  "headers",
  "lib",
  "migration-bundle",
  "migrations",
  "packaging",
  "pyext",
  "pyext_wasm",
  "probe",
  "test",
  "wasm",
] as const;

const ALLOWED_KIND_SET: ReadonlySet<string> = new Set<string>(ALLOWED_KIND_VALUES);

export function isAllowedKindValue(kind: string): boolean {
  return ALLOWED_KIND_SET.has(kind);
}

export function isAllowedKindLabel(label: string): boolean {
  if (!label.startsWith("kind:")) return false;
  return isAllowedKindValue(label.slice("kind:".length));
}
