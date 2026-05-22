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
    next = applyScopedReplacement(next, item);
  }
  return next;
}

function applyScopedReplacement(
  source: string,
  item: { label: string; before: string; after: string },
) {
  const parts = item.label.split(".");
  if (parts.length === 1) {
    if (isSupportedScalarMetadataLabel(item.label)) {
      return replaceScalarConstant(source, item.label, item);
    }
    throw new Error(`metadata patch has unsupported reviewed scalar ${item.label}`);
  }
  if (parts[0] === "_INFISICAL_MACHINE_IDENTITY_IDS" && parts.length === 2) {
    return replaceMapStringEntry(source, parts[0], parts[1], item);
  }
  if (parts[0] === "_INFISICAL_CREDENTIAL_FILE_NAMES" && parts.length === 3) {
    return replaceNestedMapStringEntry(source, parts[0], parts[1], parts[2], item);
  }
  throw new Error(`metadata patch has unsupported reviewed metadata path ${item.label}`);
}

function isSupportedScalarMetadataLabel(label: string) {
  return label === "_INFISICAL_SITE_URL" || label === "_INFISICAL_PROJECT_ID";
}

function replaceScalarConstant(
  source: string,
  name: string,
  item: { label: string; before: string; after: string },
) {
  const matches = [
    ...source.matchAll(new RegExp(`(^\\s*${escapeRegex(name)}\\s*=\\s*)"([^"]*)"`, "gm")),
  ];
  if (matches.length !== 1) throw scopedError(item.label, `expected one ${name} assignment`);
  const match = matches[0];
  return replaceCapturedValue(source, item, match.index! + match[1].length + 1, match[2]);
}

function replaceMapStringEntry(
  source: string,
  name: string,
  stage: string,
  item: { label: string; before: string; after: string },
) {
  return replaceInsideMap(source, name, (body, offset) => {
    const regex = new RegExp(`("${escapeRegex(stage)}"\\s*:\\s*")([^"]*)"`, "g");
    const matches = [...body.matchAll(regex)];
    if (matches.length !== 1) throw scopedError(item.label, `expected one ${name}.${stage} entry`);
    const match = matches[0];
    return replaceCapturedValue(source, item, offset + match.index! + match[1].length, match[2]);
  });
}

function replaceNestedMapStringEntry(
  source: string,
  name: string,
  stage: string,
  key: string,
  item: { label: string; before: string; after: string },
) {
  return replaceInsideMap(source, name, (body, offset) => {
    const stageMaps = findStageMaps(body, stage);
    if (stageMaps.length !== 1)
      throw scopedError(item.label, `expected one ${name}.${stage} entry`);
    const stageMap = stageMaps[0];
    const regex = new RegExp(`("${escapeRegex(key)}"\\s*:\\s*")([^"]*)"`, "g");
    const matches = [...stageMap.body.matchAll(regex)];
    if (matches.length !== 1) throw scopedError(item.label, `expected one ${item.label} entry`);
    const match = matches[0];
    return replaceCapturedValue(
      source,
      item,
      offset + stageMap.bodyOffset + match.index! + match[1].length,
      match[2],
    );
  });
}

function replaceInsideMap(
  source: string,
  name: string,
  replace: (body: string, offset: number) => string,
) {
  const ranges = findMapBodies(source, name);
  if (ranges.length !== 1) throw new Error(`metadata patch expected one ${name} map`);
  return replace(source.slice(ranges[0].start, ranges[0].end), ranges[0].start);
}

function findMapBodies(source: string, name: string) {
  const starts = [...source.matchAll(new RegExp(`(^\\s*${escapeRegex(name)}\\s*=\\s*\\{)`, "gm"))];
  return starts.map((match) => {
    const open = match.index! + match[1].lastIndexOf("{");
    const close = matchingBrace(source, open, name);
    return { start: open + 1, end: close };
  });
}

function findStageMaps(body: string, stage: string) {
  const matches = [...body.matchAll(new RegExp(`"${escapeRegex(stage)}"\\s*:\\s*\\{`, "g"))];
  return matches.map((match) => {
    const open = match.index! + match[0].lastIndexOf("{");
    const close = matchingBrace(body, open, stage);
    return { body: body.slice(open + 1, close), bodyOffset: open + 1 };
  });
}

function matchingBrace(source: string, open: number, label: string) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`metadata patch found unterminated map for ${label}`);
}

function replaceCapturedValue(
  source: string,
  item: { label: string; before: string; after: string },
  valueStart: number,
  current: string,
) {
  if (current !== item.before) {
    throw scopedError(
      item.label,
      `reviewed value mismatch: expected ${JSON.stringify(item.before)}`,
    );
  }
  return `${source.slice(0, valueStart)}${item.after}${source.slice(valueStart + current.length)}`;
}

function scopedError(label: string, detail: string) {
  return new Error(`metadata patch cannot safely rewrite ${label}: ${detail}`);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
