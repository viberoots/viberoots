import { freshEvidenceAt } from "./cloud-control-evidence-helpers";

export const SUPABASE_PRIVATELINK_OPENTOFU_DIR =
  "$PROFILE_ROOT/opentofu/aws-control-plane-foundation";
export const SUPABASE_PRIVATELINK_OPENTOFU_TFVARS =
  "$PROFILE_ROOT/supabase-privatelink-opentofu.tfvars.json";
export const SUPABASE_PRIVATELINK_OPENTOFU_BACKEND =
  "$PROFILE_ROOT/supabase-privatelink-backend.hcl";

export const SUPABASE_PRIVATELINK_IAC_PATHS = {
  plan: "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.json",
  apply: "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.json",
  readOnly: "$PROFILE_ROOT/supabase-privatelink-readonly-evidence.json",
} as const;

export function privateLinkCommonEvidenceErrors(
  label: string,
  record: Record<string, unknown>,
  schema: string,
  evidencePath: string,
): string[] {
  const errors: string[] = [];
  if (record.schemaVersion !== schema) {
    errors.push(`PrivateLink IaC ${label} schema is unsupported`);
  }
  if (!freshEvidenceAt(record, { maxAgeMinutes: 60 })) {
    errors.push(`PrivateLink IaC ${label} is missing or stale`);
  }
  if (text(record, "bundleRoot") !== "$PROFILE_ROOT") {
    errors.push(`PrivateLink IaC ${label} must resolve from setup bundle root`);
  }
  if (text(record, "workingDirectory") !== SUPABASE_PRIVATELINK_OPENTOFU_DIR) {
    errors.push(`PrivateLink IaC ${label} working directory must resolve from setup bundle root`);
  }
  if (text(record, "evidencePath") !== evidencePath) {
    errors.push(`PrivateLink IaC ${label} evidence path must resolve from setup bundle root`);
  }
  if (!isBundlePath(text(record, "outputPath"))) {
    errors.push(`PrivateLink IaC ${label} output path must resolve from setup bundle root`);
  }
  return errors;
}

export function privateLinkDirectMutationErrors(value: unknown): string[] {
  const serialized = JSON.stringify(value);
  return /\baws\s+(ram|vpc-lattice|iam|ec2)\s+(accept-resource-share-invitation|create-|authorize-security-group|revoke-security-group|put-|attach-|detach-)/i.test(
    serialized,
  )
    ? [
        "custom hook payload must not contain direct RAM, Lattice, IAM, or security-group mutation commands",
      ]
    : [];
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key].trim() : "";
}

export function list(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function stableJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = record[key];
        return acc;
      }, {}),
  );
}

function isBundlePath(value: string): boolean {
  return value.startsWith("$PROFILE_ROOT/") && !value.includes("..") && value.length > 14;
}
