export type ControlPlaneImageMetadata = {
  version: string;
  sourceRevision: string;
  imageDigest: string;
};

export function readControlPlaneImageMetadata(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneImageMetadata {
  return {
    version: nonSecretValue(env.VBR_CONTROL_PLANE_VERSION),
    sourceRevision: nonSecretValue(env.VBR_CONTROL_PLANE_SOURCE_REVISION),
    imageDigest: nonSecretValue(env.VBR_CONTROL_PLANE_IMAGE_DIGEST),
  };
}

function nonSecretValue(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  return trimmed || "unknown";
}
