import type { CredentialMap, CredentialMapEntry } from "./cloud-control-credential-map";

const CREDENTIAL_MAP_SCHEMA = "cloud-control-credential-map@1";

export function validateCredentialMap(
  map: CredentialMap | undefined,
  opts: {
    requiredFiles: string[];
    supabaseProjectRef?: string;
    connectionMode?: string;
    reviewedSourceMode?: string;
  },
): string[] {
  const errors: string[] = [];
  if (!map) return ["credential-map.json is required"];
  if (map.schemaVersion !== CREDENTIAL_MAP_SCHEMA)
    errors.push("credential-map.json schema invalid");
  if (map.hostMountWiring?.mode !== "bind-mounted-credential-directory") {
    errors.push("credential map must declare reviewed host credential mount wiring");
  }
  for (const [field, value] of Object.entries(map.infisical || {})) {
    if (!evidenceRef(value)) errors.push(`credential map Infisical ${field} evidence is required`);
  }
  const mapped = new Set((map.entries || []).map((entry) => entry.file));
  for (const file of opts.requiredFiles) {
    if (!mapped.has(file)) errors.push(`credential map missing ${file}`);
  }
  for (const entry of map.entries || []) {
    if (!opts.requiredFiles.includes(entry.file))
      errors.push(`credential map has unexpected ${entry.file}`);
    errors.push(...validateCredentialSource(entry));
    errors.push(...validateRotation(entry));
    if (
      JSON.stringify(entry).match(
        /secret-value|-----BEGIN|postgres:\/\/[^<\s]+:[^<\s]+@|placeholder|self-attested|dashboard-only/i,
      )
    ) {
      errors.push(`${entry.file}: credential map must not persist secret values`);
    }
  }
  if (opts.supabaseProjectRef && map.databaseUrl?.supabaseProjectRef !== opts.supabaseProjectRef) {
    errors.push("credential map database URL evidence does not match Supabase profile");
  }
  if (opts.connectionMode && map.databaseUrl?.connectionMode !== opts.connectionMode) {
    errors.push("credential map database URL mode does not match Supabase profile");
  }
  if (!evidenceRef(map.databaseUrl?.hostnameEvidenceRef)) {
    errors.push("credential map database URL hostname evidence is required");
  }
  if (opts.reviewedSourceMode && map.reviewedSource?.mode !== opts.reviewedSourceMode) {
    errors.push("credential map reviewed-source mode does not match setup input");
  }
  if (!evidenceRef(map.reviewedSource?.evidenceRef)) {
    errors.push("credential map reviewed-source evidence is required");
  }
  return errors;
}

function validateCredentialSource(entry: CredentialMapEntry): string[] {
  const errors: string[] = [];
  const source = entry.source as any;
  if (!source?.kind) return [`${entry.file}: credential source must be explicit`];
  if (source.kind === "secret-backend-ref") {
    if (source.backend !== "infisical") errors.push(`${entry.file}: secret backend is unsupported`);
    if (!source.ref) errors.push(`${entry.file}: secret backend ref is required`);
    if (!evidenceRef(source.evidenceRef)) errors.push(`${entry.file}: source evidence is required`);
    if (!evidenceRef(source.scopeEvidenceRef)) {
      errors.push(`${entry.file}: least-privilege scope evidence is required`);
    }
  } else if (source.kind === "host-credential-source") {
    if (source.source !== "aws-instance-profile") {
      errors.push(`${entry.file}: host credential source is unsupported`);
    }
    if (!evidenceRef(source.evidenceRef) || !source.hostSourceRef) {
      errors.push(`${entry.file}: host credential source evidence is required`);
    }
  } else if (source.kind === "generated-secret-write-plan") {
    if (
      source.backend !== "infisical" ||
      !source.secretName ||
      !evidenceRef(source.writePlanRef) ||
      !evidenceRef(source.policyEvidenceRef)
    ) {
      errors.push(`${entry.file}: generated-secret write plan is incomplete`);
    }
    if (!evidenceRef(source.evidenceRef)) errors.push(`${entry.file}: source evidence is required`);
  } else {
    errors.push(`${entry.file}: credential source kind is unsupported`);
  }
  return errors;
}

function validateRotation(entry: CredentialMapEntry): string[] {
  const errors: string[] = [];
  if (
    entry.rotation?.strategy !== "import-refresh" &&
    entry.rotation?.strategy !== "regenerate-write-plan"
  ) {
    errors.push(`${entry.file}: rotation strategy is unsupported`);
  }
  if (
    !Number.isInteger(entry.rotation?.staleAfterDays) ||
    entry.rotation.staleAfterDays < 1 ||
    entry.rotation.staleAfterDays > 365
  ) {
    errors.push(`${entry.file}: rotation plan is required`);
  }
  if (!evidenceRef(entry.rotation?.staleDetectionEvidenceRef)) {
    errors.push(`${entry.file}: stale credential detection evidence is required`);
  }
  return errors;
}

function evidenceRef(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^evidence:\/\//.test(value) &&
    !/placeholder|dashboard-only|self-attested|(?:^|[/:-])test(?:[/:-]|$)|\btest-ref\b/i.test(value)
  );
}
