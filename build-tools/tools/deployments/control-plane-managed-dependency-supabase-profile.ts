import * as fsp from "node:fs/promises";
import path from "node:path";
import type {
  SupabaseManagedPostgresEvidence,
  SupabaseManagedPostgresProfile,
} from "./control-plane-supabase-postgres-profile";
import {
  validateSupabaseManagedPostgresEvidence,
  validateSupabaseManagedPostgresProfile,
} from "./control-plane-supabase-postgres-validation";

export function parseSupabasePostgresProfile(
  objectValue: (value: unknown, fieldName: string) => Record<string, unknown>,
  value: unknown,
): SupabaseManagedPostgresProfile | undefined {
  if (value === undefined) return undefined;
  const profile = objectValue(
    value,
    "supabasePostgres",
  ) as unknown as SupabaseManagedPostgresProfile;
  const errors = validateSupabaseManagedPostgresProfile(profile);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return profile;
}

export function optionalEvidenceFile(value: unknown, baseDir: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("evidence file path must be a non-empty string");
  }
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export async function loadSupabasePostgresEvidence(
  filePath: string | undefined,
): Promise<SupabaseManagedPostgresEvidence | undefined> {
  if (!filePath) return undefined;
  const evidence = JSON.parse(await fsp.readFile(filePath, "utf8"));
  const lifecycle = (evidence as any)?.providerPayload?.lifecycleEvidence || evidence;
  const errors = validateSupabaseManagedPostgresEvidence(lifecycle);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return lifecycle;
}
