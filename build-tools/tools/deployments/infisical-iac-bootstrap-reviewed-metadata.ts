import * as fs from "node:fs/promises";
import * as path from "node:path";
import { canonicalInfisicalApiUrl } from "./infisical-iac-bootstrap-config";
import type { DeploymentRuntimeMetadata } from "./infisical-iac-bootstrap-types";

export const PLEOMINO_REVIEWED_METADATA_PATH = "projects/deployments/pleomino-shared/family.bzl";

export async function readPleominoReviewedMetadata(file = PLEOMINO_REVIEWED_METADATA_PATH) {
  return parsePleominoReviewedMetadata(await fs.readFile(path.resolve(file), "utf8"));
}

export function parsePleominoReviewedMetadata(source: string): Required<DeploymentRuntimeMetadata> {
  const siteUrl = canonicalInfisicalApiUrl(stringConstant(source, "_INFISICAL_SITE_URL"));
  const projectId = stringConstant(source, "_INFISICAL_PROJECT_ID");
  const projectName = stringConstant(source, "_INFISICAL_PROJECT_NAME");
  const projectSlug = stringConstant(source, "_INFISICAL_PROJECT_SLUG");
  const environmentSlugs = stringMap(source, "_INFISICAL_ENVIRONMENT_SLUGS");
  const secretPath = stringConstant(source, "_INFISICAL_SECRET_PATH");
  const cloudflareSecretName = stringConstant(source, "_INFISICAL_CLOUDFLARE_SECRET_NAME");
  const identityIds = stringMap(source, "_INFISICAL_MACHINE_IDENTITY_IDS");
  const identityNames = stringMap(source, "_INFISICAL_MACHINE_IDENTITY_NAMES");
  const credentialNames = nestedStringMap(source, "_INFISICAL_CREDENTIAL_FILE_NAMES");
  const credentialRefs = nestedStringMap(source, "_INFISICAL_CREDENTIAL_REFS");
  const stages = Object.keys(identityIds).sort(stageOrder);
  return {
    siteUrl,
    projectName,
    projectId,
    projectSlug,
    secretPath,
    cloudflareSecretName,
    environments: Object.fromEntries(
      stages.map((stage) => [
        stage,
        { slug: required(environmentSlugs[stage], `_INFISICAL_ENVIRONMENT_SLUGS.${stage}`) },
      ]),
    ),
    deploymentCredentials: stages.map((stage) => ({
      stage,
      identityId: required(identityIds[stage], `_INFISICAL_MACHINE_IDENTITY_IDS.${stage}`),
      identityName: required(identityNames[stage], `_INFISICAL_MACHINE_IDENTITY_NAMES.${stage}`),
      clientIdRef: required(
        credentialRefs[stage]?.client_id,
        `_INFISICAL_CREDENTIAL_REFS.${stage}.client_id`,
      ),
      clientSecretRef: required(
        credentialRefs[stage]?.client_secret,
        `_INFISICAL_CREDENTIAL_REFS.${stage}.client_secret`,
      ),
      clientIdFileName: required(
        credentialNames[stage]?.client_id,
        `_INFISICAL_CREDENTIAL_FILE_NAMES.${stage}.client_id`,
      ),
      clientSecretFileName: required(
        credentialNames[stage]?.client_secret,
        `_INFISICAL_CREDENTIAL_FILE_NAMES.${stage}.client_secret`,
      ),
    })),
  };
}

function stringConstant(source: string, name: string) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  return required(match?.[1], name);
}

function stringMap(source: string, name: string) {
  const body = mapBody(source, name);
  return Object.fromEntries(
    [...body.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
}

function nestedStringMap(source: string, name: string) {
  const body = mapBody(source, name);
  return Object.fromEntries(
    [...body.matchAll(/"([^"]+)"\s*:\s*\{([\s\S]*?)\}/g)].map((stage) => [
      stage[1],
      Object.fromEntries(
        [...stage[2].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
      ),
    ]),
  ) as Record<string, Record<string, string>>;
}

function mapBody(source: string, name: string) {
  const start = source.indexOf(`${name} = {`);
  if (start < 0) throw new Error(`missing ${name} in checked-in Pleomino metadata`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, i);
  }
  throw new Error(`unterminated ${name} map in checked-in Pleomino metadata`);
}

function required(value: string | undefined, label: string) {
  if (!value) throw new Error(`missing ${label} in checked-in Pleomino metadata`);
  return value;
}

function stageOrder(left: string, right: string) {
  const order = ["staging", "prod"];
  return (order.indexOf(left) + 1 || 99) - (order.indexOf(right) + 1 || 99);
}
