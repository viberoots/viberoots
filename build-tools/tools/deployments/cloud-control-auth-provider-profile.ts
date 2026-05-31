import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";

export const AUTH_PROVIDER_PROFILE_SCHEMA = "cloud-control-auth-provider-profile@1";

export type AuthProviderProfileKind = "local" | "supabase-auth" | "workos" | "external-oidc";

export type AuthProviderProfile = {
  schemaVersion: typeof AUTH_PROVIDER_PROFILE_SCHEMA;
  lifecycleMode: "reviewed" | "fixture";
  provider: AuthProviderProfileKind;
  issuer: string;
  audience: string[];
  jwksUrl: string;
  callback: { externalHost: string; externalPath: string; registrationEvidenceRef: string };
  claims: DeploymentAuthProviderConfig["claims"];
  roleGroups: DeploymentAuthProviderConfig["roleGroups"];
  servicePrincipals: Record<string, string>;
  metadata: { environment: string; evidenceDigest: string; jwksCheckedAt: string };
  smokeEvidence: { cliLoginRef?: string; pkceCallbackRef?: string; checkedAt?: string };
};

export function validateAuthProviderProfile(
  profile: AuthProviderProfile | undefined,
  opts: { expectedCallbackHost: string; expectedCallbackPath: string; production: boolean },
): string[] {
  const errors: string[] = [];
  if (!profile) return ["auth-provider profile is required"];
  if (profile.schemaVersion !== AUTH_PROVIDER_PROFILE_SCHEMA) {
    errors.push("auth-provider profile schemaVersion invalid");
  }
  if (!["local", "supabase-auth", "workos", "external-oidc"].includes(profile.provider)) {
    errors.push("auth-provider provider is unsupported");
  }
  if (opts.production && profile.lifecycleMode !== "reviewed") {
    errors.push("production auth-provider profile must be reviewed");
  }
  if (opts.production && profile.provider === "local") {
    errors.push("production auth-provider profile cannot use local provider mode");
  }
  for (const field of ["issuer", "jwksUrl"] as const) {
    if (!String(profile[field] || "").trim()) errors.push(`auth-provider ${field} is required`);
  }
  if (opts.production && !/^https:\/\//.test(profile.issuer || "")) {
    errors.push("production auth-provider issuer must be https");
  }
  if (!Array.isArray(profile.audience) || profile.audience.length === 0) {
    errors.push("auth-provider audience is required");
  }
  if (opts.production && !profile.audience?.includes("deployments-control-plane")) {
    errors.push("auth-provider audience does not include deployments-control-plane");
  }
  if (profile.callback?.externalHost !== opts.expectedCallbackHost) {
    errors.push("auth-provider callback host does not match setup ingress input");
  }
  if (profile.callback?.externalPath !== opts.expectedCallbackPath) {
    errors.push("auth-provider callback path does not match setup ingress input");
  }
  if (!profile.callback?.registrationEvidenceRef) {
    errors.push("auth-provider callback registration evidence is required");
  }
  if (
    !profile.roleGroups?.deployer?.length ||
    !profile.roleGroups?.admin?.length ||
    !profile.roleGroups?.admissionReporter?.length
  ) {
    errors.push(
      "auth-provider role/group mappings must include deployer, admission reporter, and admin groups",
    );
  }
  for (const [name, value] of Object.entries(profile.claims || {})) {
    if (!String(value || "").trim()) errors.push(`auth-provider claim mapping ${name} is required`);
  }
  if (Object.keys(profile.servicePrincipals || {}).length === 0) {
    errors.push("auth-provider service-principal mappings are required");
  }
  if (!profile.metadata?.environment || !profile.metadata?.evidenceDigest) {
    errors.push("auth-provider metadata environment and evidence digest are required");
  }
  if (opts.production && profile.metadata?.environment !== "production") {
    errors.push("auth-provider metadata environment must be production");
  }
  if (!freshIso(profile.metadata?.jwksCheckedAt)) {
    errors.push("auth-provider JWKS metadata evidence is stale or missing");
  }
  const smokeRefs = [profile.smokeEvidence?.cliLoginRef, profile.smokeEvidence?.pkceCallbackRef];
  if (!smokeRefs.every(reviewedEvidenceRef) || !freshIso(profile.smokeEvidence?.checkedAt)) {
    errors.push("auth-provider CLI login and PKCE callback smoke evidence is required");
  }
  if (
    opts.production &&
    placeholder(
      [
        profile.issuer,
        profile.jwksUrl,
        profile.callback.registrationEvidenceRef,
        profile.metadata.evidenceDigest,
        ...smokeRefs,
      ].join(" "),
    )
  ) {
    errors.push("auth-provider profile contains production placeholder metadata");
  }
  return errors;
}

export function runtimeAuthConfig(profile: AuthProviderProfile): DeploymentAuthProviderConfig {
  return {
    kind: profile.provider === "local" ? "local-oidc" : "generic-oidc-jwks",
    issuer: profile.issuer,
    audience: profile.audience,
    jwksUrl: profile.jwksUrl,
    tokenSupport: "jwt",
    cliLoginMode: "pkce-public-callback",
    callback: {
      externalHost: profile.callback.externalHost,
      externalPath: profile.callback.externalPath,
    },
    claims: profile.claims,
    roleGroups: profile.roleGroups,
    servicePrincipals: profile.servicePrincipals,
  };
}

export function runtimeInputPlaceholder(value: string): boolean {
  return /https:\/\/auth\.example\.test|fixture-only|placeholder|manual-note|dashboard-only|self-attested|(?:^|[/:-])test(?:[/:-]|$)|\btest-ref\b/i.test(
    value,
  );
}

function freshIso(value: string | undefined): boolean {
  if (!value) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && Date.now() - millis < 7 * 24 * 60 * 60 * 1000;
}

function reviewedEvidenceRef(value: string | undefined): boolean {
  return (
    typeof value === "string" && /^evidence:\/\//.test(value) && !runtimeInputPlaceholder(value)
  );
}

const placeholder = runtimeInputPlaceholder;
