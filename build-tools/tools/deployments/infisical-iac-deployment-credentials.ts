import { listClientSecrets, summarizeClientSecretRecords } from "./infisical-iac-bootstrap-api";
import { createUniversalAuthClientSecret, readClientId } from "./infisical-iac-bootstrap-identity";
import { universalAuthSecretDescription } from "./infisical-iac-machine-label";
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
  const remoteSecretSummaries = summarizeClientSecretRecords(remoteSecrets);
  const localSecret = await opts.sink.read(item.clientSecretRef);
  const localClientId = await opts.sink.read(item.clientIdRef);
  if (localClientId && localClientId !== clientId && !opts.args.rotateDeploymentCredentials) {
    throw new Error(clientIdMismatchMessage(item.clientIdRef));
  }
  if (localSecret && !opts.args.rotateDeploymentCredentials) {
    await preserveClientId(opts.sink, item.clientIdRef, localClientId, clientId);
    return lifecycleResult(item, "reused", remoteSecrets.length, remoteSecretSummaries);
  }
  if (
    localSecret &&
    opts.args.rotateDeploymentCredentials &&
    !opts.args.forceOverwriteLocalCredentials
  ) {
    throw new Error(rotationOverwriteMessage(opts.sink.describe(), item));
  }
  if (localClientId && localClientId !== clientId && !opts.args.forceOverwriteLocalCredentials) {
    throw new Error(clientIdMismatchMessage(item.clientIdRef));
  }
  const clientSecret = await createDeploymentClientSecret(opts, identity, item);
  if (localClientId !== clientId) {
    await opts.sink.write(item.clientIdRef, clientId, opts.args.forceOverwriteLocalCredentials);
  }
  await opts.sink.write(
    item.clientSecretRef,
    clientSecret,
    opts.args.forceOverwriteLocalCredentials,
  );
  return lifecycleResult(
    item,
    opts.args.rotateDeploymentCredentials ? "rotated" : "created",
    remoteSecrets.length,
    remoteSecretSummaries,
  );
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
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
) {
  return await createUniversalAuthClientSecret(
    opts.api,
    opts.args,
    identity,
    universalAuthSecretDescription({
      args: opts.args,
      identity,
      purpose: `deployment ${item.stage}`,
    }),
  );
}

function lifecycleResult(
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
  status: DeploymentCredentialLifecycleResult["status"],
  remoteClientSecretRecords: number,
  remoteClientSecretRecordSummaries: DeploymentCredentialLifecycleResult["remoteClientSecretRecordSummaries"],
) {
  return {
    stage: item.stage,
    identityId: item.identityId,
    identityName: item.identityName,
    clientIdRef: item.clientIdRef,
    clientSecretRef: item.clientSecretRef,
    status,
    remoteClientSecretRecords,
    remoteClientSecretRecordSummaries,
  };
}

function rotationOverwriteMessage(
  sinkDescription: string,
  item: NonNullable<DeploymentRuntimeMetadata["deploymentCredentials"]>[number],
) {
  return `The configured ${sinkDescription} credential already has ${item.clientSecretRef}. Rerun with --rotate-deployment-credentials --force-overwrite-local-credentials to replace this machine's local credential.`;
}
