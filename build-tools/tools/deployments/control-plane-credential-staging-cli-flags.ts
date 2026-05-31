import { getFlagStr } from "../lib/cli";

export function liveFlagOpts() {
  return {
    liveBackendProfile: getFlagStr("live-backend-profile", "").trim(),
    secretBackendEvidence: getFlagStr("secret-backend-evidence", "").trim(),
    credentialDirectory: getFlagStr("credential-directory", "").trim(),
    liveHostVerificationEvidence: getFlagStr("live-host-verification-evidence", "").trim(),
    liveHostVerifierProfile: getFlagStr("live-host-verifier-profile", "").trim(),
    credentialOwnerUid: numberFlag("credential-owner-uid"),
    credentialOwnerGid: numberFlag("credential-owner-gid"),
    hostMountEvidence: getFlagStr("host-mount-evidence", "").trim(),
  };
}

function numberFlag(name: string): number | undefined {
  const raw = getFlagStr(name, "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}
