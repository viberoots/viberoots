import * as fs from "node:fs/promises";
import * as path from "node:path";
import { canonicalInfisicalApiUrl } from "./infisical-iac-bootstrap-config";
import type { DeploymentRuntimeMetadata } from "./infisical-iac-bootstrap-types";
import { stripJsonComments } from "./json-comments";

export const PLEOMINO_REVIEWED_METADATA_PATH = "projects/deployments/pleomino/shared/family.bzl";
export const PLEOMINO_REVIEWED_CONTEXT_CONFIG_PATH = "projects/config/shared.json";

export async function readPleominoReviewedMetadata(file = PLEOMINO_REVIEWED_METADATA_PATH) {
  const source = await readPleominoReviewedMetadataSource(file);
  if (source.includes("_INFISICAL_SITE_URL")) return parsePleominoReviewedMetadata(source);
  return parsePleominoReviewedContextConfig(source);
}

export async function readPleominoReviewedMetadataSource(file = PLEOMINO_REVIEWED_METADATA_PATH) {
  const resolved = path.resolve(file);
  const source = await fs.readFile(resolved, "utf8");
  if (source.includes("_INFISICAL_SITE_URL")) return source;
  return await fs.readFile(pleominoContextConfigPath(resolved), "utf8");
}

export function parsePleominoReviewedContextConfig(
  source: string,
): Required<DeploymentRuntimeMetadata> {
  const config = JSON.parse(stripJsonComments(source)) as Record<string, unknown>;
  const contexts = record(config.deploymentContexts, "deploymentContexts");
  const stages = ["staging", "prod"] as const;
  const stageContexts: Record<(typeof stages)[number], Record<string, unknown>> = {
    staging: record(contexts["pleomino-staging"], "pleomino-staging"),
    prod: record(contexts["pleomino-prod"], "pleomino-prod"),
  };
  const firstInfisical = infisicalSection(stageContexts.staging, "pleomino-staging");
  const cloudflareSecretName = secretName(
    stringField(cloudflareSection(stageContexts.staging, "pleomino-staging"), "apiTokenRef"),
  );
  return {
    siteUrl: canonicalInfisicalApiUrl(stringField(firstInfisical, "host")),
    projectId: stringField(firstInfisical, "projectId"),
    projectName: stringField(firstInfisical, "projectName"),
    projectSlug: stringField(firstInfisical, "projectSlug"),
    secretPath: stringField(firstInfisical, "defaultPath"),
    cloudflareSecretName,
    environments: Object.fromEntries(
      stages.map((stage) => {
        const section = infisicalSection(stageContexts[stage], `pleomino-${stage}`);
        return [stage, { slug: stringField(section, "environment") }];
      }),
    ),
    deploymentCredentials: stages.map((stage) => {
      const section = infisicalSection(stageContexts[stage], `pleomino-${stage}`);
      return {
        stage,
        identityId: stringField(section, "machineIdentityId"),
        identityName: stringField(section, "machineIdentityName"),
        clientIdRef: stringField(section, "clientIdRef"),
        clientSecretRef: stringField(section, "clientSecretRef"),
        clientIdFileName: stringField(section, "clientIdFileName"),
        clientSecretFileName: stringField(section, "clientSecretFileName"),
      };
    }),
  };
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
  const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "s"));
  return required(match?.[1], name);
}

function stringMap(source: string, name: string) {
  const body = mapBody(source, name);
  return Object.fromEntries(
    [...body.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
}

function nestedStringMap(source: string, name: string) {
  const body = mapBody(source, name);
  return Object.fromEntries(
    [...body.matchAll(/"([^"]+)"\s*:\s*\{([\s\S]*?)\}/g)].map((stage) => [
      stage[1],
      Object.fromEntries(
        [...stage[2].matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]),
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
  if (value === undefined) throw new Error(`missing ${label} in checked-in Pleomino metadata`);
  return value;
}

function pleominoContextConfigPath(resolvedMetadataPath: string) {
  const marker = `${path.sep}projects${path.sep}deployments${path.sep}pleomino${path.sep}`;
  const index = resolvedMetadataPath.indexOf(marker);
  const root = index >= 0 ? resolvedMetadataPath.slice(0, index) : process.cwd();
  return path.join(root, PLEOMINO_REVIEWED_CONTEXT_CONFIG_PATH);
}

function infisicalSection(context: Record<string, unknown>, label: string) {
  return record(context.infisical, `${label}.infisical`);
}

function cloudflareSection(context: Record<string, unknown>, label: string) {
  return record(context.cloudflare, `${label}.cloudflare`);
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`missing ${label} in checked-in Pleomino metadata`);
  }
  return value as Record<string, unknown>;
}

function stringField(recordValue: Record<string, unknown>, key: string) {
  const value = recordValue[key];
  return required(typeof value === "string" ? value : undefined, key);
}

function secretName(ref: string) {
  return required(ref.split("/").filter(Boolean).pop(), "cloudflare.apiTokenRef secret name");
}

function stageOrder(left: string, right: string) {
  const order = ["staging", "prod"];
  return (order.indexOf(left) + 1 || 99) - (order.indexOf(right) + 1 || 99);
}
