#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";

type SchemaMigration<T> = (raw: Record<string, unknown>) => T;

type ReadVersionedJsonOpts<T> = {
  kind: string;
  currentSchemaVersion: string;
  migrations?: Record<string, SchemaMigration<T>>;
  validateCurrent?: (raw: Record<string, unknown>) => raw is T;
};

function readSchemaVersion(raw: Record<string, unknown>): string {
  const camel = raw.schemaVersion;
  if (typeof camel === "string" && camel.trim()) return camel;
  const snake = raw.schema_version;
  return typeof snake === "string" ? snake.trim() : "";
}

function unsupportedSchemaError(kind: string, schemaVersion: string, filePath: string): Error {
  return new Error(
    `unsupported ${kind} schema version "${schemaVersion || "<missing>"}": ${filePath}`,
  );
}

export async function readVersionedJson<T>(
  filePath: string,
  opts: ReadVersionedJsonOpts<T>,
): Promise<T> {
  const raw = JSON.parse(await fsp.readFile(filePath, "utf8")) as Record<string, unknown>;
  const schemaVersion = readSchemaVersion(raw);
  if (schemaVersion === opts.currentSchemaVersion) {
    if (opts.validateCurrent && !opts.validateCurrent(raw)) {
      throw new Error(`invalid ${opts.kind}: ${filePath}`);
    }
    return raw as T;
  }
  const migrated = opts.migrations?.[schemaVersion];
  if (migrated) return migrated(raw);
  throw unsupportedSchemaError(opts.kind, schemaVersion, filePath);
}
