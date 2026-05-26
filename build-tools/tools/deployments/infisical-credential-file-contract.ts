import type { DeploymentCredentialRef } from "./infisical-iac-bootstrap-types";

export function exactInfisicalCredentialFileName(
  credential: DeploymentCredentialRef | undefined,
  kind: "client_id" | "client_secret",
): string | undefined {
  if (!credential) return undefined;
  const ref = kind === "client_id" ? credential.clientIdRef : credential.clientSecretRef;
  const actual =
    kind === "client_id" ? credential.clientIdFileName : credential.clientSecretFileName;
  if (!actual) return actual;
  const expected = expectedInfisicalCredentialFileName(ref, kind);
  if (actual !== expected) {
    throw new Error(
      `metadata handoff ${credential.stage} ${kind} file name must be exactly ${expected}`,
    );
  }
  return actual;
}

function expectedInfisicalCredentialFileName(
  ref: string | undefined,
  kind: "client_id" | "client_secret",
) {
  const suffix = kind === "client_id" ? "id" : "secret";
  const match = ref?.match(
    /^secret:\/\/deployments\/([^/]+)\/([^/]+)\/infisical-client-(id|secret)$/,
  );
  if (!match || match[3] !== suffix) {
    throw new Error(
      `metadata handoff cannot derive Infisical credential file name from ${kind} ref`,
    );
  }
  return `${match[1]}-${match[2]}-infisical-client-${suffix}`;
}
