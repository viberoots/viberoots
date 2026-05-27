#!/usr/bin/env zx-wrapper
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";

const PROCESS_SECRET_NAMES = [
  "VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL",
  "VBR_DEPLOY_CONTROL_PLANE_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ENDPOINT_URL",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_ENDPOINT",
  "GITHUB_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "INFISICAL_CLIENT_ID",
  "INFISICAL_CLIENT_SECRET",
  "INFISICAL_ACCESS_TOKEN",
  "INFISICAL_SERVICE_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "VBR_CONTROL_PLANE_ARTIFACT_STORE_ENDPOINT",
  "VBR_CONTROL_PLANE_ARTIFACT_STORE_ACCESS_KEY_ID",
  "VBR_CONTROL_PLANE_ARTIFACT_STORE_SECRET_ACCESS_KEY",
];

function dropProcessSecretNames(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  for (const name of PROCESS_SECRET_NAMES) delete scrubbed[name];
  return scrubbed;
}

export function scrubControlPlaneChildEnv(
  extra: NodeJS.ProcessEnv = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...dropProcessSecretNames(scrubDeploymentSecretEnv(base)),
    ...extra,
  };
}
