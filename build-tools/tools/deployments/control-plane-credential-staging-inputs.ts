import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CredentialMap } from "./cloud-control-credential-map";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import type {
  ExternalReviewedBackendProof,
  ExternalReviewedHostProof,
  LiveBackendWriteEvidence,
  LiveHostVerificationEvidence,
  LiveHostVerifierProfile,
} from "./control-plane-credential-staging-types";

export type CredentialManifestInput = {
  credentialDirectory?: string;
  reviewedSourceMode?: string;
  requiredFiles?: string[];
};

export type CredentialStagingInputs = {
  manifest: CredentialManifestInput;
  credentialMap: CredentialMap;
  configText: string;
  supabaseProfile?: SupabaseManagedPostgresProfile;
  liveBackendWriteEvidence?: LiveBackendWriteEvidence;
  liveHostMountEvidence?: LiveHostVerificationEvidence;
  externalReviewedBackendProof?: ExternalReviewedBackendProof;
  externalReviewedHostProof?: ExternalReviewedHostProof;
};

export async function readCredentialStagingInputs(
  bundleDir: string,
  opts: {
    live?: boolean;
    secretBackendEvidence?: string;
    hostMountEvidence?: string;
    liveHostVerificationEvidence?: string;
    liveHostVerifierProfile?: string;
  } = {},
): Promise<CredentialStagingInputs> {
  const root = path.resolve(bundleDir);
  const [
    manifest,
    credentialMap,
    configText,
    supabaseProfile,
    backendEvidence,
    mountEvidence,
    liveHostVerification,
    liveHostVerifierProfile,
  ] = await Promise.all([
    readJson(path.join(root, "credential-manifest.json")),
    readJson(path.join(root, "credential-map.json")),
    fsp.readFile(path.join(root, "config.yaml"), "utf8"),
    readJson(path.join(root, "supabase-postgres.profile.json")).catch(() => undefined),
    opts.live && opts.secretBackendEvidence ? readJson(opts.secretBackendEvidence) : undefined,
    opts.live && opts.hostMountEvidence ? readJson(opts.hostMountEvidence) : undefined,
    opts.live && opts.liveHostVerificationEvidence
      ? readJson(opts.liveHostVerificationEvidence)
      : undefined,
    opts.live && opts.liveHostVerifierProfile ? readJson(opts.liveHostVerifierProfile) : undefined,
  ]);
  return {
    manifest,
    credentialMap,
    configText,
    supabaseProfile,
    liveHostMountEvidence: bindRemoteHostVerifier(liveHostVerification, liveHostVerifierProfile),
    externalReviewedBackendProof: externalProof(backendEvidence),
    externalReviewedHostProof: externalProof(mountEvidence),
  };
}

function bindRemoteHostVerifier(
  evidence: LiveHostVerificationEvidence | undefined,
  profile: LiveHostVerifierProfile | undefined,
): LiveHostVerificationEvidence | undefined {
  if (!evidence) return undefined;
  const { reviewedVerifierProfile: _ignored, ...untrustedEvidence } = evidence as any;
  return profile ? { ...untrustedEvidence, reviewedVerifierProfile: profile } : untrustedEvidence;
}

function externalProof(
  evidence: unknown,
): ExternalReviewedBackendProof | ExternalReviewedHostProof | undefined {
  return evidence ? { source: "external-reviewed-proof", evidence } : undefined;
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}
