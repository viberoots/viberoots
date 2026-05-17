import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { listClientSecrets } from "./infisical-iac-bootstrap-api";
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
  const ref = `secret://deployments/pleomino/bootstrap/${opts.identity.name}/client-secret`;
  const remoteSecrets = await listClientSecrets(opts.api, opts.identity.id);
  const localSecret = await opts.sink.read(ref);
  if (remoteSecrets.length > 0 && localSecret && !opts.args.rotateBootstrapCredentials) {
    return { clientId, clientSecret: localSecret };
  }
  if (remoteSecrets.length > 0 && !opts.args.rotateBootstrapCredentials) {
    throw new Error(
      `Infisical reports an existing Universal Auth client secret record for ${opts.identity.name}, but the configured ${opts.sink.describe()} credential is missing. Import the existing value or rerun with --rotate-bootstrap-credentials.`,
    );
  }
  if (localSecret && !opts.args.forceOverwriteLocalCredentials) {
    throw new Error(
      `The configured ${opts.sink.describe()} credential already has a bootstrap client secret for ${opts.identity.name}, but Infisical has no matching usable remote record or rotation was requested. No new remote client secret was created. Preserve the existing value by restoring/importing the remote record, or rerun with --rotate-bootstrap-credentials --force-overwrite-local-credentials to replace it.`,
    );
  }
  const clientSecret = await createUniversalAuthClientSecret(opts.api, opts.args, opts.identity);
  await opts.sink.write(ref, clientSecret, opts.args.forceOverwriteLocalCredentials);
  return { clientId, clientSecret };
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
) {
  const result = await api.request<{ clientSecret?: string }>(
    "POST",
    `/api/v1/auth/universal-auth/identities/${encodeURIComponent(identity.id)}/client-secrets`,
    { description: "viberoots IaC bootstrap", numUsesLimit: 0, ttl: args.clientSecretTtl },
  );
  if (!result?.clientSecret)
    throw new Error("Infisical did not return a Universal Auth client secret");
  return result.clientSecret;
}
