import { resolveInfisicalAccessToken } from "./deployment-secret-infisical-credentials";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { ensureRepoResolverConfig } from "./infisical-iac-bootstrap-resolver";
import { createCredentialSink } from "./infisical-iac-bootstrap-sink";
import type { BootstrapArgs, CredentialSink } from "./infisical-iac-bootstrap-types";
import { validateInfisicalRepoProject } from "./infisical-iac-bootstrap-profile-api";
import type { SharedInfisicalSession } from "./infisical-iac-bootstrap-repo-credential";
import { readSprinkleRefConfig, resolveSprinkleRefBackend } from "./sprinkleref-config";

type ResolverResult = Awaited<ReturnType<typeof ensureRepoResolverConfig>>;
type VerificationDeps = {
  credentialSinkFactory?: (
    args: BootstrapArgs,
    opts: { workspaceRoot: string; configPath: string },
  ) => Promise<CredentialSink>;
  verifyUniversalAuth?: (credential: {
    siteUrl: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<void>;
};

export async function verifyRepoBootstrapState(
  args: BootstrapArgs,
  resolver: ResolverResult,
  credential: SharedInfisicalSession | undefined,
  deps: VerificationDeps,
) {
  const config = await readSprinkleRefConfig(resolver.configPath, resolver.workspaceRoot);
  return {
    bootstrap:
      credential?.bootstrapCredential && credential.identity
        ? await verifyBootstrapCredentials(args, resolver, credential, deps)
        : { status: "not-required" as const },
    main: await verifyMainCredentialBackend(args, resolver, credential, deps, config),
  };
}

async function verifyBootstrapCredentials(
  args: BootstrapArgs,
  resolver: ResolverResult,
  credential: SharedInfisicalSession,
  deps: VerificationDeps,
) {
  const sink = await createVerificationCredentialSink(args, resolver, deps);
  const refs = repoBootstrapCredentialRefs(credential.identity, args.bootstrapCredentialScope);
  const clientId = await requiredSinkValue(sink, refs.clientIdRef, "bootstrap client id");
  const clientSecret = await requiredSinkValue(
    sink,
    refs.clientSecretRef,
    "bootstrap client secret",
  );
  if (clientId !== credential.bootstrapCredential?.clientId) {
    throw new Error(`bootstrap credential verification failed: ${refs.clientIdRef} mismatch`);
  }
  if (clientSecret !== credential.bootstrapCredential.clientSecret) {
    throw new Error(`bootstrap credential verification failed: ${refs.clientSecretRef} mismatch`);
  }
  await verifyUniversalAuth(deps, { siteUrl: args.apiUrl, clientId, clientSecret });
  return {
    status: "verified" as const,
    clientIdRef: refs.clientIdRef,
    clientSecretRef: refs.clientSecretRef,
    auth: "verified" as const,
  };
}

async function verifyMainCredentialBackend(
  args: BootstrapArgs,
  resolver: ResolverResult,
  credential: SharedInfisicalSession | undefined,
  deps: VerificationDeps,
  config: Awaited<ReturnType<typeof readSprinkleRefConfig>>,
) {
  const resolved = resolveSprinkleRefBackend(config, config.defaultCategory || "main");
  if (resolved.backend.backend !== "infisical") {
    return {
      status: "not-authenticated" as const,
      category: resolved.category,
      backend: resolved.backend.backend,
      reason: "backend has no Infisical auth probe",
    };
  }
  if (!credential) throw new Error("main Infisical credential verification needs repo session");
  const projectId = resolved.backend.projectId || envValue(resolved.backend.projectIdEnv);
  if (!projectId) throw new Error("main Infisical credential verification missing project id");
  await validateInfisicalRepoProject(credential.api, credential.organizationId, projectId, {
    requireOrganizationEvidence: false,
  });
  const sink = await createVerificationCredentialSink(args, resolver, deps);
  const clientId = await credentialValue(
    sink,
    resolved.backend.clientIdEnv,
    resolved.backend.clientIdRef,
    "main Infisical client id",
  );
  const clientSecret = await credentialValue(
    sink,
    resolved.backend.clientSecretEnv,
    resolved.backend.clientSecretRef,
    "main Infisical client secret",
  );
  await verifyUniversalAuth(deps, {
    siteUrl: resolved.backend.host || args.apiUrl,
    clientId,
    clientSecret,
  });
  return {
    status: "verified" as const,
    category: resolved.category,
    profile: resolved.profile,
    backend: "infisical" as const,
    projectId,
    auth: "verified" as const,
  };
}

async function credentialValue(
  sink: CredentialSink,
  envName: string | undefined,
  ref: string | undefined,
  label: string,
) {
  const fromEnv = envValue(envName);
  if (fromEnv) return fromEnv;
  if (!ref) throw new Error(`${label} is not configured`);
  return await requiredSinkValue(sink, ref, label);
}

async function requiredSinkValue(sink: CredentialSink, ref: string, label: string) {
  const value = (await sink.read(ref))?.trim();
  if (!value) throw new Error(`bootstrap verification failed: missing ${label} at ${ref}`);
  return value;
}

async function createVerificationCredentialSink(
  args: BootstrapArgs,
  resolver: ResolverResult,
  deps: VerificationDeps,
) {
  const opts = { workspaceRoot: resolver.workspaceRoot, configPath: resolver.configPath };
  return await (deps.credentialSinkFactory || createCredentialSink)(args, opts);
}

function envValue(name?: string) {
  return name ? String(process.env[name] || "").trim() : "";
}

async function verifyUniversalAuth(
  deps: VerificationDeps,
  credential: { siteUrl: string; clientId: string; clientSecret: string },
) {
  if (deps.verifyUniversalAuth) return await deps.verifyUniversalAuth(credential);
  await resolveInfisicalAccessToken({ kind: "universal_auth", ...credential });
}
