import { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { getAccessToken } from "./infisical-iac-bootstrap-auth";
import {
  ensureBootstrapCredential,
  ensureIdentity,
  ensureUniversalAuth,
} from "./infisical-iac-bootstrap-identity";
import { resolveOrganizationId } from "./infisical-iac-bootstrap-org";
import { createCredentialSink } from "./infisical-iac-bootstrap-sink";
import type { BootstrapArgs, BootstrapCredential, Identity } from "./infisical-iac-bootstrap-types";

export type SharedInfisicalSession = {
  api: InfisicalApi;
  apiUrl: string;
  organizationId: string;
  identity: Identity;
  bootstrapCredential?: BootstrapCredential;
};

export async function ensureRepoBootstrapCredential(
  args: BootstrapArgs,
  opts: { workspaceRoot?: string; configPath?: string } = {},
) {
  const session = await createInfisicalSession(args);
  const resolvedArgs = { ...args, organizationId: session.organizationId };
  await ensureUniversalAuth(session.api, resolvedArgs, session.identity);
  const sink = await createCredentialSink(args, opts);
  const bootstrapCredential = await ensureBootstrapCredential({
    api: session.api,
    args,
    identity: session.identity,
    sink,
  });
  return { ...session, bootstrapCredential };
}

export async function createInfisicalSession(args: BootstrapArgs): Promise<SharedInfisicalSession> {
  const access = await getAccessToken(args);
  const api = new InfisicalApi({ apiUrl: args.apiUrl, token: access.token });
  const organizationId = await resolveOrganizationId(api, args);
  const resolvedArgs = { ...args, organizationId };
  const identity = await ensureIdentity(api, resolvedArgs);
  if (access.cleanupMessage) console.error(access.cleanupMessage);
  return { api, apiUrl: args.apiUrl, organizationId, identity };
}
