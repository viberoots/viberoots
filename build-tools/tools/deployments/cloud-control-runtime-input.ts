import fs from "node:fs";
import YAML from "yaml";
import {
  AUTH_PROVIDER_PROFILE_SCHEMA,
  runtimeInputPlaceholder,
  validateAuthProviderProfile,
  type AuthProviderProfile,
} from "./cloud-control-auth-provider-profile";

export {
  AUTH_PROVIDER_PROFILE_SCHEMA,
  runtimeAuthConfig,
  validateAuthProviderProfile,
  type AuthProviderProfile,
  type AuthProviderProfileKind,
} from "./cloud-control-auth-provider-profile";

export const RUNTIME_INPUT_SCHEMA = "cloud-control-runtime-input@1";

export type RuntimeInputMode = "production" | "local-fixture";

export type RuntimeInput = {
  schemaVersion: typeof RUNTIME_INPUT_SCHEMA;
  mode: RuntimeInputMode;
  provenance: {
    supabaseProjectRef: string;
    supabaseConnectionMode: string;
    awsAccountId?: string;
    awsRegion?: string;
    awsVpcId?: string;
    artifactCredentialMode: string;
  };
  authProvider: AuthProviderProfile;
  infisicalDeployments: Array<{
    deploymentId: string;
    siteUrl: string;
    projectId: string;
    environment: string;
    evidenceRef: string;
  }>;
};

export function readRuntimeInputFile(filePath: string): RuntimeInput {
  const raw = fs.readFileSync(filePath, "utf8");
  return parseRuntimeInput(raw);
}

export function parseRuntimeInput(raw: string): RuntimeInput {
  const value = YAML.parse(raw) as RuntimeInput;
  if (!value || typeof value !== "object") throw new Error("runtime input must be an object");
  return value;
}

export function defaultReviewedRuntimeInput(opts: {
  publicUrl: string;
  authCallbackHost: string;
  authCallbackPath: string;
  deploymentIds: string[];
  supabaseProjectRef?: string;
  supabaseConnectionMode?: string;
  awsAccountId?: string;
  awsRegion?: string;
  awsVpcId?: string;
  artifactCredentialMode?: string;
}): RuntimeInput {
  const issuer = `${opts.publicUrl.replace(/\/+$/, "")}/oidc`;
  return {
    schemaVersion: RUNTIME_INPUT_SCHEMA,
    mode: "production",
    authProvider: {
      schemaVersion: AUTH_PROVIDER_PROFILE_SCHEMA,
      lifecycleMode: "reviewed",
      provider: "external-oidc",
      issuer,
      audience: ["deployments-control-plane"],
      jwksUrl: `${issuer}/.well-known/jwks.json`,
      callback: {
        externalHost: opts.authCallbackHost,
        externalPath: opts.authCallbackPath,
        registrationEvidenceRef: "evidence://auth-provider/callback-registration",
      },
      claims: {
        userIdClaim: "sub",
        emailClaim: "email",
        roleClaim: "groups",
        servicePrincipalClaim: "azp",
      },
      roleGroups: {
        deployer: ["deployers"],
        admissionReporter: ["admission-reporters"],
        admin: ["deploy-admins"],
      },
      servicePrincipals: { "control-plane-service": "deployment-control-plane" },
      metadata: {
        environment: "production",
        evidenceDigest: "sha256:auth-provider-metadata",
        jwksCheckedAt: new Date().toISOString(),
      },
      smokeEvidence: {
        cliLoginRef: "evidence://auth-provider/cli-login",
        pkceCallbackRef: "evidence://auth-provider/pkce-callback",
        checkedAt: new Date().toISOString(),
      },
    },
    provenance: {
      supabaseProjectRef: opts.supabaseProjectRef || "fixture-only-supabase-project",
      supabaseConnectionMode: opts.supabaseConnectionMode || "public",
      awsAccountId: opts.awsAccountId,
      awsRegion: opts.awsRegion,
      awsVpcId: opts.awsVpcId,
      artifactCredentialMode: opts.artifactCredentialMode || "files",
    },
    infisicalDeployments: opts.deploymentIds.map((deploymentId) => ({
      deploymentId,
      siteUrl: "https://app.infisical.com",
      projectId: `reviewed-${deploymentId}-infisical-project`,
      environment: "production",
      evidenceRef: `evidence://infisical/${deploymentId}/project-environment`,
    })),
  };
}

export function validateRuntimeInput(
  input: RuntimeInput | undefined,
  opts: {
    expectedCallbackHost: string;
    expectedCallbackPath: string;
    deploymentIds: string[];
    production: boolean;
    supabaseProjectRef?: string;
    supabaseConnectionMode?: string;
    awsAccountId?: string;
    awsRegion?: string;
    awsVpcId?: string;
    artifactCredentialMode?: string;
  },
): string[] {
  const errors: string[] = [];
  if (!input) return ["cloud control-plane setup requires runtime input"];
  if (input.schemaVersion !== RUNTIME_INPUT_SCHEMA)
    errors.push("runtime input schemaVersion invalid");
  if (opts.production && input.mode !== "production") {
    errors.push("production setup requires production runtime input");
  }
  errors.push(...validateRuntimeProvenance(input, opts));
  errors.push(...validateAuthProviderProfile(input.authProvider, opts));
  const deployments = new Map(
    input.infisicalDeployments.map((entry) => [entry.deploymentId, entry]),
  );
  for (const deploymentId of opts.deploymentIds) {
    const entry = deployments.get(deploymentId);
    if (!entry) {
      errors.push(`runtime input missing Infisical deployment ${deploymentId}`);
      continue;
    }
    for (const field of ["siteUrl", "projectId", "environment", "evidenceRef"] as const) {
      if (!String(entry[field] || "").trim()) {
        errors.push(`runtime input Infisical ${deploymentId} ${field} is required`);
      }
    }
    if (
      opts.production &&
      runtimeInputPlaceholder(`${entry.siteUrl} ${entry.projectId} ${entry.evidenceRef}`)
    ) {
      errors.push(`runtime input Infisical ${deploymentId} contains placeholder metadata`);
    }
  }
  return errors;
}

function validateRuntimeProvenance(
  input: RuntimeInput,
  opts: {
    production: boolean;
    supabaseProjectRef?: string;
    supabaseConnectionMode?: string;
    awsAccountId?: string;
    awsRegion?: string;
    awsVpcId?: string;
    artifactCredentialMode?: string;
  },
): string[] {
  const errors: string[] = [];
  const provenance = input.provenance;
  if (!provenance) return ["runtime input provenance is required"];
  if (opts.supabaseProjectRef && provenance.supabaseProjectRef !== opts.supabaseProjectRef) {
    errors.push("runtime input Supabase project ref does not match setup profile");
  }
  if (
    opts.supabaseConnectionMode &&
    provenance.supabaseConnectionMode !== opts.supabaseConnectionMode
  ) {
    errors.push("runtime input Supabase connection mode does not match setup profile");
  }
  if (opts.awsAccountId && provenance.awsAccountId !== opts.awsAccountId) {
    errors.push("runtime input AWS account does not match topology evidence");
  }
  if (opts.awsRegion && provenance.awsRegion !== opts.awsRegion) {
    errors.push("runtime input AWS region does not match topology evidence");
  }
  if (opts.awsVpcId && provenance.awsVpcId !== opts.awsVpcId) {
    errors.push("runtime input AWS VPC does not match topology evidence");
  }
  if (
    opts.artifactCredentialMode &&
    provenance.artifactCredentialMode !== opts.artifactCredentialMode
  ) {
    errors.push("runtime input artifact credential mode does not match setup input");
  }
  if (opts.production && runtimeInputPlaceholder(JSON.stringify(provenance))) {
    errors.push("runtime input provenance contains placeholder metadata");
  }
  return errors;
}
