import { randomBytes } from "node:crypto";
import type { CredentialMap, CredentialMapEntry } from "./cloud-control-credential-map";
import type { LiveBackendWriteEvidence } from "./control-plane-credential-staging-types";
import {
  profileCredential,
  type LiveInfisicalBackendProfile,
} from "./control-plane-credential-live-profile";
import { writeInfisicalSecret } from "./deployment-secret-infisical-write";

export async function writeGeneratedSecretsToInfisical(opts: {
  credentialMap: CredentialMap;
  profile: LiveInfisicalBackendProfile;
  fetchImpl?: typeof fetch;
}): Promise<LiveBackendWriteEvidence> {
  const plans = generatedPlans(opts.credentialMap);
  assertProfileMatchesPlans(opts.profile, plans);
  const writtenSecrets = [];
  for (const entry of plans) {
    const source = entry.source as any;
    const result = await writeInfisicalSecret({
      credential: profileCredential(opts.profile),
      selector: source.selector,
      secretValue: generatedSecretValue(),
      fetchImpl: opts.fetchImpl,
    });
    writtenSecrets.push({
      file: entry.file,
      secretName: result.secretName,
      writePlanRef: source.writePlanRef,
      ...(result.version ? { version: result.version } : {}),
    });
  }
  return {
    schemaVersion: "control-plane-credential-live-backend-write@1",
    checkedAt: new Date().toISOString(),
    liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1",
    backend: "infisical",
    source: "deployment-owned-live-write",
    projectId: opts.profile.projectId,
    environment: opts.profile.environment,
    secretPath: opts.profile.secretPath,
    deploymentIdentityEvidenceRef: opts.profile.deploymentIdentityEvidenceRef,
    leastPrivilegeScopeEvidenceRef: opts.profile.leastPrivilegeScopeEvidenceRef,
    leastPrivilegeScope: opts.profile.leastPrivilegeScope,
    generatedSecretWritePlanIds: plans.map((entry) => (entry.source as any).writePlanRef),
    writtenSecrets,
    noSecretValuesPersisted: true,
    evidenceRef: "evidence://credential-staging/deployment-owned-live-backend-write",
  };
}

function generatedPlans(map: CredentialMap): CredentialMapEntry[] {
  return map.entries.filter(
    (entry) => (entry.source as any).kind === "generated-secret-write-plan",
  );
}

function assertProfileMatchesPlans(
  profile: LiveInfisicalBackendProfile,
  plans: CredentialMapEntry[],
): void {
  if (plans.length === 0) throw new Error("credential map has no generated-secret write plans");
  for (const entry of plans) {
    const source = entry.source as any;
    const selector = source.selector || {};
    if (
      selector.projectId !== profile.projectId ||
      selector.environment !== profile.environment ||
      selector.secretPath !== profile.secretPath
    ) {
      throw new Error(`${entry.file}: generated-secret selector does not match live profile`);
    }
    if (source.deploymentIdentityEvidenceRef !== profile.deploymentIdentityEvidenceRef) {
      throw new Error(`${entry.file}: deployment identity evidence does not match live profile`);
    }
    if (source.leastPrivilegeScopeEvidenceRef !== profile.leastPrivilegeScopeEvidenceRef) {
      throw new Error(`${entry.file}: least-privilege scope evidence does not match live profile`);
    }
    if (
      JSON.stringify(source.leastPrivilegeScope) !== JSON.stringify(profile.leastPrivilegeScope)
    ) {
      throw new Error(`${entry.file}: least-privilege scope does not match live profile`);
    }
    if (!profile.leastPrivilegeScope.allowedSecretNames.includes(selector.secretName)) {
      throw new Error(`${entry.file}: least-privilege scope does not allow generated secret`);
    }
  }
}

function generatedSecretValue(): string {
  return `vbr_${randomBytes(32).toString("base64url")}`;
}
