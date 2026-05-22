import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { listClientSecrets, summarizeClientSecretRecords } from "./infisical-iac-bootstrap-api";
import { universalAuthSecretDescription } from "./infisical-iac-machine-label";
import type {
  BootstrapArgs,
  BootstrapCredential,
  CredentialSink,
  Identity,
} from "./infisical-iac-bootstrap-types";

type IdentityListEntry = {
  identityId?: string;
  identity?: { id?: string; name?: string };
};

export async function findIdentity(
  api: InfisicalApi,
  args: BootstrapArgs & { organizationId: string },
) {
  const result = await api.request<{ identities: IdentityListEntry[] }>(
    "GET",
    `/api/v1/identities?orgId=${encodeURIComponent(args.organizationId)}`,
  );
  const matches = (result?.identities ?? []).filter(
    (item) => item.identity?.name === args.identityName,
  );
  if (matches.length > 1) {
    throw new Error(
      `found ${matches.length} Infisical identities named ${JSON.stringify(args.identityName)}; rename or delete duplicates before bootstrapping`,
    );
  }
  const entry = matches[0];
  const id = entry?.identity?.id || entry?.identityId;
  return id && entry?.identity?.name ? { id, name: entry.identity.name } : undefined;
}

export async function ensureIdentity(
  api: InfisicalApi,
  args: BootstrapArgs & { organizationId: string },
): Promise<Identity> {
  const existing = await findIdentity(api, args);
  if (existing) return existing;
  const result = await api.request<{ identity: Identity }>("POST", "/api/v1/identities", {
    name: args.identityName,
    organizationId: args.organizationId,
    role: args.orgRole,
    hasDeleteProtection: true,
    metadata: [{ key: "managed_by", value: "viberoots-iac-bootstrap" }],
  });
  if (!result?.identity?.id)
    throw new Error("Infisical identity create response did not include an id");
  return result.identity;
}

export async function ensureUniversalAuth(
  api: InfisicalApi,
  args: BootstrapArgs,
  identity: Identity,
) {
  const endpoint = `/api/v1/auth/universal-auth/identities/${encodeURIComponent(identity.id)}`;
  const existing = await api.request<unknown>("GET", endpoint, undefined, true);
  if (existing) return;
  await api.request("POST", endpoint, universalAuthBody(args));
}

export async function ensureProjectIdentityMembership(
  api: InfisicalApi,
  projectId: string,
  identity: Identity,
  role = "admin",
) {
  const endpoint = `/api/v1/projects/${encodeURIComponent(projectId)}/memberships/identities/${encodeURIComponent(identity.id)}`;
  const existing = await api.request<unknown>("GET", endpoint, undefined, true);
  if (existing) return { changed: false };
  await api.request("POST", endpoint, { role, roles: [{ role, isTemporary: false }] });
  return { changed: true };
}

export async function readClientId(api: InfisicalApi, identity: Identity) {
  const auth = await api.request<{ identityUniversalAuth?: { clientId?: string } }>(
    "GET",
    `/api/v1/auth/universal-auth/identities/${encodeURIComponent(identity.id)}`,
  );
  const clientId = auth?.identityUniversalAuth?.clientId;
  if (!clientId)
    throw new Error("Infisical Universal Auth retrieve response did not include clientId");
  return clientId;
}

export async function ensureBootstrapCredential(opts: {
  api: InfisicalApi;
  args: BootstrapArgs;
  identity: Identity;
  sink: CredentialSink;
}): Promise<BootstrapCredential> {
  const clientId = await readClientId(opts.api, opts.identity);
  const refs = repoBootstrapCredentialRefs(opts.identity);
  const remoteSecrets = await listClientSecrets(opts.api, opts.identity.id);
  const remoteSecretSummaries = summarizeClientSecretRecords(remoteSecrets);
  const localSecret = await opts.sink.read(refs.clientSecretRef);
  const localClientId = await opts.sink.read(refs.clientIdRef);
  if (localClientId && localClientId !== clientId && !opts.args.rotateBootstrapCredentials) {
    throw new Error(bootstrapClientIdMismatchMessage(refs.clientIdRef));
  }
  if (localSecret && !opts.args.rotateBootstrapCredentials) {
    await preserveBootstrapClientId(opts.sink, refs.clientIdRef, localClientId, clientId);
    return {
      clientId,
      clientSecret: localSecret,
      status: "reused",
      remoteClientSecretRecords: remoteSecrets.length,
      remoteClientSecretRecordSummaries: remoteSecretSummaries,
    };
  }
  if (
    localSecret &&
    opts.args.rotateBootstrapCredentials &&
    !opts.args.forceOverwriteLocalCredentials
  ) {
    throw new Error(
      `The configured ${opts.sink.describe()} credential already has a bootstrap client secret for ${opts.identity.name}. Rerun with --rotate-bootstrap-credentials --force-overwrite-local-credentials to replace this machine's local credential.`,
    );
  }
  if (localClientId && localClientId !== clientId && !opts.args.forceOverwriteLocalCredentials) {
    throw new Error(bootstrapClientIdMismatchMessage(refs.clientIdRef));
  }
  const clientSecret = await createUniversalAuthClientSecret(
    opts.api,
    opts.args,
    opts.identity,
    universalAuthSecretDescription({
      args: opts.args,
      identity: opts.identity,
      purpose: "repo-bootstrap",
    }),
  );
  if (localClientId !== clientId) {
    await opts.sink.write(refs.clientIdRef, clientId, opts.args.forceOverwriteLocalCredentials);
  }
  await opts.sink.write(
    refs.clientSecretRef,
    clientSecret,
    opts.args.forceOverwriteLocalCredentials,
  );
  return {
    clientId,
    clientSecret,
    status: opts.args.rotateBootstrapCredentials ? "rotated" : "created",
    remoteClientSecretRecords: remoteSecrets.length,
    remoteClientSecretRecordSummaries: remoteSecretSummaries,
  };
}

export function repoBootstrapCredentialRefs(identity: Pick<Identity, "name">) {
  const prefix = `secret://viberoots/bootstrap/${identity.name}`;
  return {
    clientIdRef: `${prefix}/client-id`,
    clientSecretRef: `${prefix}/client-secret`,
  };
}

async function preserveBootstrapClientId(
  sink: CredentialSink,
  ref: string,
  existing: string | undefined,
  clientId: string,
) {
  if (!existing) return await sink.write(ref, clientId, false);
  if (existing === clientId) return;
  throw new Error(bootstrapClientIdMismatchMessage(ref));
}

function bootstrapClientIdMismatchMessage(ref: string) {
  return `credential ${ref} already contains a different Universal Auth client id; local/resolver values may be replaced only when a new remote credential is created with --rotate-bootstrap-credentials --force-overwrite-local-credentials`;
}

export function universalAuthBody(args: BootstrapArgs) {
  return {
    clientSecretTrustedIps: [{ ipAddress: "0.0.0.0/0" }, { ipAddress: "::/0" }],
    accessTokenTrustedIps: [{ ipAddress: "0.0.0.0/0" }, { ipAddress: "::/0" }],
    accessTokenTTL: args.accessTokenTtl,
    accessTokenMaxTTL: args.accessTokenTtl,
    accessTokenNumUsesLimit: 0,
    accessTokenPeriod: 0,
    lockoutEnabled: true,
    lockoutThreshold: 3,
    lockoutDurationSeconds: 300,
    lockoutCounterResetSeconds: 30,
  };
}

export async function createUniversalAuthClientSecret(
  api: InfisicalApi,
  args: BootstrapArgs,
  identity: Identity,
  description = "viberoots IaC bootstrap",
) {
  const result = await api.request<{ clientSecret?: string }>(
    "POST",
    `/api/v1/auth/universal-auth/identities/${encodeURIComponent(identity.id)}/client-secrets`,
    { description, numUsesLimit: 0, ttl: args.clientSecretTtl },
  );
  if (!result?.clientSecret)
    throw new Error("Infisical did not return a Universal Auth client secret");
  return result.clientSecret;
}
