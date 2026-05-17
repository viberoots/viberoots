import { listClientSecrets } from "./infisical-iac-bootstrap-api";
import { createUniversalAuthClientSecret, readClientId } from "./infisical-iac-bootstrap-identity";
import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import type {
  BootstrapArgs,
  CredentialSink,
  DeploymentCredentialLifecycleResult,
  DeploymentRuntimeMetadata,
  Identity,
} from "./infisical-iac-bootstrap-types";

export async function ensureDeploymentCredentials(opts: {
  api: InfisicalApi;
  args: BootstrapArgs;
  sink: CredentialSink;
  metadata: DeploymentRuntimeMetadata;
}): Promise<DeploymentCredentialLifecycleResult[]> {
  const credentials = opts.metadata.deploymentCredentials ?? [];
  const results: DeploymentCredentialLifecycleResult[] = [];
  for (const credential of credentials) {
    results.push(await ensureOneDeploymentCredential(opts, credential));
  }
  return results;
}

async function ensureOneDeploymentCredential(
  opts: { api: InfisicalApi; args: BootstrapArgs; sink: CredentialSink },
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
): Promise<DeploymentCredentialLifecycleResult> {
  const identity = { id: item.identityId, name: item.identityName };
  const clientId = await readClientId(opts.api, identity);
  const remoteSecrets = await listClientSecrets(opts.api, item.identityId);
  const localSecret = await opts.sink.read(item.clientSecretRef);
  const localClientId = await opts.sink.read(item.clientIdRef);
  if (remoteSecrets.length > 0 && localSecret && !opts.args.rotateDeploymentCredentials) {
    await preserveClientId(opts.sink, item.clientIdRef, localClientId, clientId);
    return lifecycleResult(item, "preserved");
  }
  if (remoteSecrets.length > 0 && !opts.args.rotateDeploymentCredentials) {
    throw new Error(missingLocalSecretMessage(opts.sink.describe(), item));
  }
  if ((localSecret || localClientId) && !opts.args.rotateDeploymentCredentials) {
    throw new Error(localWithoutRemoteMessage(opts.sink.describe(), item));
  }
  if (localSecret && !opts.args.forceOverwriteLocalCredentials) {
    throw new Error(localWithoutRemoteMessage(opts.sink.describe(), item));
  }
  if (localClientId && localClientId !== clientId && !opts.args.forceOverwriteLocalCredentials) {
    throw new Error(clientIdMismatchMessage(item.clientIdRef));
  }
  const clientSecret = await createDeploymentClientSecret(opts, identity, item.stage);
  if (localClientId !== clientId) {
    await opts.sink.write(item.clientIdRef, clientId, opts.args.forceOverwriteLocalCredentials);
  }
  await opts.sink.write(
    item.clientSecretRef,
    clientSecret,
    opts.args.forceOverwriteLocalCredentials,
  );
  return lifecycleResult(item, "rotated");
}

async function preserveClientId(
  sink: CredentialSink,
  ref: string,
  existing: string | undefined,
  clientId: string,
) {
  if (!existing) return await sink.write(ref, clientId, false);
  if (existing === clientId) return;
  throw new Error(clientIdMismatchMessage(ref));
}

function clientIdMismatchMessage(ref: string) {
  return `credential ${ref} already contains a different Universal Auth client id; local/resolver values may be replaced only when a new remote credential is created with --rotate-deployment-credentials --force-overwrite-local-credentials`;
}

async function createDeploymentClientSecret(
  opts: { api: InfisicalApi; args: BootstrapArgs },
  identity: Identity,
  stage: string,
) {
  return await createUniversalAuthClientSecret(
    opts.api,
    opts.args,
    identity,
    `viberoots Pleomino ${stage} deployment`,
  );
}

function lifecycleResult(
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
  status: DeploymentCredentialLifecycleResult["status"],
) {
  return {
    stage: item.stage,
    identityId: item.identityId,
    identityName: item.identityName,
    clientIdRef: item.clientIdRef,
    clientSecretRef: item.clientSecretRef,
    status,
  };
}

function missingLocalSecretMessage(
  sinkDescription: string,
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
) {
  return `Infisical reports an existing Universal Auth client secret record for ${item.identityName}, but the configured ${sinkDescription} credential ${item.clientSecretRef} is missing. Import the existing value or rerun with --rotate-deployment-credentials.`;
}

function localWithoutRemoteMessage(
  sinkDescription: string,
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
) {
  return `The configured ${sinkDescription} credential already has ${item.clientSecretRef}, but Infisical has no matching usable remote record or rotation was requested. No new remote client secret was created. Preserve the existing value by restoring/importing the remote record, or rerun with --rotate-deployment-credentials --force-overwrite-local-credentials to replace it.`;
}
