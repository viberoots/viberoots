import crypto from "node:crypto";
import { remoteHostEvidenceDigest } from "../../deployments/control-plane-credential-host-verifier-trust";
import type {
  LiveHostVerificationEvidence,
  LiveHostVerifierProfile,
  LiveHostVerifierTrustAnchor,
} from "../../deployments/control-plane-credential-staging-types";

const verifierKey = crypto.generateKeyPairSync("ed25519");

export function liveHostVerifierProfile(
  evidence: LiveHostVerificationEvidence,
  overrides: Partial<LiveHostVerifierProfile> = {},
): LiveHostVerifierProfile {
  const publicKeyPem = verifierKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  const digest = remoteHostEvidenceDigest(evidence);
  return {
    schemaVersion: "control-plane-live-host-verifier-profile@1",
    verifierIdentity: evidence.verifierIdentity,
    sourceHostIdentity: evidence.provenance?.sourceHostIdentity || "aws-ec2:i-cloud-review",
    targetPath: evidence.targetPath,
    filenameSet: [...evidence.filenameSet],
    awsBindMountVerified: true,
    evidenceDigest: digest,
    evidenceRef: "evidence://credential-staging/reviewed-remote-host-verifier-profile",
    reviewedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    publicKeyFingerprint: keyFingerprint(publicKeyPem),
    publicKey: {
      kind: "ed25519",
      pem: publicKeyPem,
      fingerprint: keyFingerprint(publicKeyPem),
    },
    reviewedTrustAnchor: liveHostVerifierTrustAnchor(),
    signature: crypto.sign(null, Buffer.from(digest), verifierKey.privateKey).toString("base64url"),
    ...overrides,
  };
}

export function liveHostVerifierTrustAnchor(
  overrides: Partial<LiveHostVerifierTrustAnchor> = {},
): LiveHostVerifierTrustAnchor {
  const publicKeyPem = verifierKey.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    schemaVersion: "control-plane-live-host-verifier-trust@1",
    verifierIdentity: "reviewed-aws-ec2-credential-host-verifier",
    trustedPublicKeys: [
      { kind: "ed25519", pem: publicKeyPem, fingerprint: keyFingerprint(publicKeyPem) },
    ],
    trustedCommandDigests: ["sha256:reviewed-verifier-command"],
    evidenceRef: "evidence://credential-staging/reviewed-remote-host-verifier-trust",
    reviewedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

export function wrongPublicKeyProfile(
  evidence: LiveHostVerificationEvidence,
): LiveHostVerifierProfile {
  const wrong = crypto.generateKeyPairSync("ed25519");
  const pem = wrong.publicKey.export({ type: "spki", format: "pem" }).toString();
  return liveHostVerifierProfile(evidence, {
    publicKeyFingerprint: keyFingerprint(pem),
    publicKey: { kind: "ed25519", pem, fingerprint: keyFingerprint(pem) },
  });
}

export function commandAttestationProfile(
  evidence: LiveHostVerificationEvidence,
): LiveHostVerifierProfile {
  const digest = remoteHostEvidenceDigest(evidence);
  return {
    ...liveHostVerifierProfile(evidence, {
      publicKey: undefined,
      publicKeyFingerprint: undefined,
      signature: undefined,
    }),
    commandAttestation: {
      kind: "deployment-owned-verifier-command",
      command: "deployment-control-plane credential-host-verifier",
      commandDigest: "sha256:reviewed-verifier-command",
      evidenceDigest: digest,
      producedBy: "deployment-control-plane",
      evidenceRef: "evidence://credential-staging/remote-verifier-command-attestation",
      reviewedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
  };
}

function keyFingerprint(pem: string): string {
  return `sha256:${crypto.createHash("sha256").update(pem).digest("hex")}`;
}
