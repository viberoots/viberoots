import { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { getAccessToken } from "./infisical-iac-bootstrap-auth";
import {
  ensureBootstrapCredential,
  ensureIdentity,
  ensureUniversalAuth,
} from "./infisical-iac-bootstrap-identity";
import { resolveOrganizationId } from "./infisical-iac-bootstrap-org";
import { createCredentialSink } from "./infisical-iac-bootstrap-sink";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

export async function ensureRepoBootstrapCredential(args: BootstrapArgs) {
  const access = await getAccessToken(args);
  const api = new InfisicalApi({ apiUrl: args.apiUrl, token: access.token });
  const organizationId = await resolveOrganizationId(api, args);
  const resolvedArgs = { ...args, organizationId };
  const identity = await ensureIdentity(api, resolvedArgs);
  await ensureUniversalAuth(api, resolvedArgs, identity);
  const sink = await createCredentialSink(args);
  await ensureBootstrapCredential({ api, args, identity, sink });
  if (access.cleanupMessage) console.error(access.cleanupMessage);
  return { api, organizationId, identity };
}
