import {
  artifactCredentialMode,
  assertArtifactCredentialModeAllowed,
} from "./control-plane-artifact-credential-mode";
import { assertCredentialDirectoryPath } from "./control-plane-runtime-config-paths";

export function normalizeRuntimeArtifactStore(value: Record<string, unknown>) {
  const provider = enumValue(
    value.provider ?? "s3-compatible",
    ["aws-s3", "supabase-storage-s3", "cloudflare-r2", "s3-compatible"],
    "storage.artifactStore.provider",
  );
  const credentialMode = artifactCredentialMode(value.credentialMode);
  assertArtifactCredentialModeAllowed({
    provider,
    credentialMode,
    fieldName: "storage.artifactStore.credentialMode",
  });
  if (credentialMode === "files" && (!value.accessKeyIdFile || !value.secretAccessKeyFile)) {
    throw new Error("storage.artifactStore file credential mode requires access key files");
  }
  return {
    kind: enumValue(value.kind ?? "s3-compatible", ["s3-compatible"], "storage.artifactStore.kind"),
    provider,
    credentialMode,
    bucket: stringValue(value.bucket, "storage.artifactStore.bucket"),
    region: stringValue(value.region ?? "auto", "storage.artifactStore.region"),
    endpointFile: stringValue(value.endpointFile, "storage.artifactStore.endpointFile"),
    accessKeyIdFile: optionalString(value.accessKeyIdFile, "storage.artifactStore.accessKeyIdFile"),
    secretAccessKeyFile: optionalString(
      value.secretAccessKeyFile,
      "storage.artifactStore.secretAccessKeyFile",
    ),
  };
}

export function resolveRuntimeArtifactStorePaths(
  store: ReturnType<typeof normalizeRuntimeArtifactStore>,
  policy: { credentialDirectory: string; repoRoot?: string },
) {
  return {
    ...store,
    endpointFile: assertCredentialDirectoryPath(store.endpointFile, policy),
    accessKeyIdFile: store.accessKeyIdFile
      ? assertCredentialDirectoryPath(store.accessKeyIdFile, policy)
      : undefined,
    secretAccessKeyFile: store.secretAccessKeyFile
      ? assertCredentialDirectoryPath(store.secretAccessKeyFile, policy)
      : undefined,
  };
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, fieldName);
}

function enumValue<T extends string>(value: unknown, choices: T[], fieldName: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${fieldName} has unsupported value`);
  }
  return value as T;
}
