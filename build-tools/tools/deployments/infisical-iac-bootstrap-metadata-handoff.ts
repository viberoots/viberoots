import * as fs from "node:fs/promises";
import { exactInfisicalCredentialFileName } from "./infisical-credential-file-contract";
import { PLEOMINO_REVIEWED_CONTEXT_CONFIG_PATH } from "./infisical-iac-bootstrap-reviewed-metadata";
import type { DeploymentRuntimeMetadata } from "./infisical-iac-bootstrap-types";
import { stripJsonComments } from "./json-comments";

export type MetadataHandoffPatch = {
  schemaVersion: "infisical-iac-bootstrap-metadata-patch@1";
  path: string;
  replacements: Array<{ label: string; before: string; after: string }>;
  unifiedDiff: string;
};

export async function applyMetadataHandoffPatch(patch: MetadataHandoffPatch) {
  const source = await fs.readFile(patch.path, "utf8");
  await fs.writeFile(patch.path, applyReplacements(source, patch.replacements));
}

export function buildMetadataHandoffPatch(
  live: DeploymentRuntimeMetadata,
  reviewed: Required<DeploymentRuntimeMetadata>,
  source: string,
): MetadataHandoffPatch {
  const replacements = reviewedMetadataReplacements(live, reviewed);
  return {
    schemaVersion: "infisical-iac-bootstrap-metadata-patch@1",
    path: PLEOMINO_REVIEWED_CONTEXT_CONFIG_PATH,
    replacements,
    unifiedDiff: diffLines(source, applyReplacements(source, replacements)),
  };
}

export function reviewedMetadataReplacements(
  live: DeploymentRuntimeMetadata,
  reviewed: Required<DeploymentRuntimeMetadata>,
) {
  return reviewed.deploymentCredentials
    .flatMap((expected) => {
      const actual = live.deploymentCredentials?.find((item) => item.stage === expected.stage);
      const prefix = `deploymentContexts.pleomino-${expected.stage}.infisical`;
      return [
        replacement(`${prefix}.host`, reviewed.siteUrl ?? "", live.siteUrl),
        replacement(`${prefix}.projectId`, reviewed.projectId, live.projectId),
        replacement(`${prefix}.machineIdentityId`, expected.identityId, actual?.identityId),
        replacement(
          `${prefix}.clientIdFileName`,
          expected.clientIdFileName || "",
          exactInfisicalCredentialFileName(actual, "client_id"),
        ),
        replacement(
          `${prefix}.clientSecretFileName`,
          expected.clientSecretFileName || "",
          exactInfisicalCredentialFileName(actual, "client_secret"),
        ),
      ];
    })
    .filter((item): item is { label: string; before: string; after: string } => Boolean(item));
}

export function isFirstBootstrapPlaceholder(value: string) {
  return value === "" || /^(proj_pleomino_deployments|identity_pleomino_.*_deploy)$/.test(value);
}

function replacement(label: string, before: string, after?: string) {
  if (before === after) return undefined;
  if (!after) throw new Error(`metadata patch missing live value for ${label}`);
  return { label, before, after };
}

function applyReplacements(
  source: string,
  replacements: Array<{ label: string; before: string; after: string }>,
) {
  const next = JSON.parse(stripJsonComments(source)) as Record<string, unknown>;
  for (const item of replacements) {
    applyJsonReplacement(next, item);
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

function applyJsonReplacement(
  root: Record<string, unknown>,
  item: { label: string; before: string; after: string },
) {
  const parts = item.label.split(".");
  const key = parts.at(-1);
  if (!key) throw scopedError(item.label, "empty metadata path");
  let cursor: unknown = root;
  for (const part of parts.slice(0, -1)) {
    cursor = jsonRecord(cursor, part, item.label)[part];
  }
  const parent = jsonRecord(cursor, parts.at(-2) ?? "root", item.label);
  const current = parent[key];
  if (current !== item.before) {
    throw scopedError(
      item.label,
      `reviewed value mismatch: expected ${JSON.stringify(item.before)}`,
    );
  }
  parent[key] = item.after;
}

function jsonRecord(value: unknown, label: string, replacementLabel: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw scopedError(replacementLabel, `expected object at ${label}`);
  }
  return value as Record<string, unknown>;
}

function scopedError(label: string, detail: string) {
  return new Error(`metadata patch cannot safely rewrite ${label}: ${detail}`);
}

function diffLines(before: string, after: string) {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines = [
    `--- a/${PLEOMINO_REVIEWED_CONTEXT_CONFIG_PATH}`,
    `+++ b/${PLEOMINO_REVIEWED_CONTEXT_CONFIG_PATH}`,
  ];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) continue;
    if (left[index] !== undefined) lines.push(`-${left[index]}`);
    if (right[index] !== undefined) lines.push(`+${right[index]}`);
  }
  return `${lines.join("\n")}\n`;
}
