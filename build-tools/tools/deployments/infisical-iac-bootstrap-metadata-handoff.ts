import * as fs from "node:fs/promises";
import { PLEOMINO_REVIEWED_METADATA_PATH } from "./infisical-iac-bootstrap-reviewed-metadata";
import type { DeploymentRuntimeMetadata } from "./infisical-iac-bootstrap-types";

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
    path: PLEOMINO_REVIEWED_METADATA_PATH,
    replacements,
    unifiedDiff: diffLines(source, applyReplacements(source, replacements)),
  };
}

export function reviewedMetadataReplacements(
  live: DeploymentRuntimeMetadata,
  reviewed: Required<DeploymentRuntimeMetadata>,
) {
  return [
    replacement("_INFISICAL_SITE_URL", reviewed.siteUrl, live.siteUrl),
    replacement("_INFISICAL_PROJECT_ID", reviewed.projectId, live.projectId),
    ...reviewed.deploymentCredentials.flatMap((expected) => {
      const actual = live.deploymentCredentials?.find((item) => item.stage === expected.stage);
      return [
        replacement(
          `_INFISICAL_MACHINE_IDENTITY_IDS.${expected.stage}`,
          expected.identityId,
          actual?.identityId,
        ),
        replacement(
          `_INFISICAL_CREDENTIAL_FILE_NAMES.${expected.stage}.client_id`,
          expected.clientIdFileName || "",
          actual?.clientIdFileName,
        ),
        replacement(
          `_INFISICAL_CREDENTIAL_FILE_NAMES.${expected.stage}.client_secret`,
          expected.clientSecretFileName || "",
          actual?.clientSecretFileName,
        ),
      ];
    }),
  ].filter((item): item is { label: string; before: string; after: string } => Boolean(item));
}

export function isFirstBootstrapPlaceholder(value: string) {
  return value === "" || /^(proj_pleomino_deployments|identity_pleomino_.*_deploy)$/.test(value);
}

function replacement(label: string, before: string, after?: string) {
  if (!after || before === after) return undefined;
  return { label, before, after };
}

function applyReplacements(
  source: string,
  replacements: Array<{ label: string; before: string; after: string }>,
) {
  let next = source;
  for (const item of replacements) {
    const quotedBefore = JSON.stringify(item.before);
    const quotedAfter = JSON.stringify(item.after);
    if (!next.includes(quotedBefore)) {
      throw new Error(`metadata patch could not find reviewed value for ${item.label}`);
    }
    next = next.replace(quotedBefore, quotedAfter);
  }
  return next;
}

function diffLines(before: string, after: string) {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines = [
    `--- a/${PLEOMINO_REVIEWED_METADATA_PATH}`,
    `+++ b/${PLEOMINO_REVIEWED_METADATA_PATH}`,
  ];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) continue;
    if (left[index] !== undefined) lines.push(`-${left[index]}`);
    if (right[index] !== undefined) lines.push(`+${right[index]}`);
  }
  return `${lines.join("\n")}\n`;
}
