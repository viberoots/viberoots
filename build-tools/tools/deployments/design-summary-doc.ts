#!/usr/bin/env zx-wrapper
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeploymentProviderCapability } from "./deployment-provider-capabilities";
import { REVIEWED_PROVIDER_CAPABILITIES } from "./deployment-provider-capabilities";

const viberootsSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEPLOYMENTS_DESIGN_DOC_PATH = path.join(
  viberootsSourceRoot,
  "docs/history/designs/deployments-design.md",
);
export const GENERATED_IDENTITY_SUMMARY_START =
  "<!-- BEGIN GENERATED REVIEWED PROVIDER IDENTITY SUMMARY -->";
export const GENERATED_IDENTITY_SUMMARY_END =
  "<!-- END GENERATED REVIEWED PROVIDER IDENTITY SUMMARY -->";
export const GENERATED_CAPABILITY_SUMMARY_START =
  "<!-- BEGIN GENERATED REVIEWED PROVIDER CAPABILITY SUMMARY -->";
export const GENERATED_CAPABILITY_SUMMARY_END =
  "<!-- END GENERATED REVIEWED PROVIDER CAPABILITY SUMMARY -->";

function replaceGeneratedBlock(
  template: string,
  startMarker: string,
  endMarker: string,
  rendered: string,
) {
  const start = template.indexOf(startMarker);
  const end = template.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`missing reviewed provider summary markers in ${DEPLOYMENTS_DESIGN_DOC_PATH}`);
  }
  const before = template.slice(0, start + startMarker.length);
  const after = template.slice(end);
  return `${before}\n\n${rendered}\n\n${after}`;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join("<br>") : "none";
}

function codeList(values: readonly string[]): string {
  return formatList(values.map((value) => `\`${value}\``));
}

function nestedCodes(
  bullets: { text: string; children?: { text: string }[] }[],
  label: string,
): string[] {
  const match = bullets.find((entry) => entry.text.startsWith(label));
  return (match?.children || [])
    .map((entry) => entry.text.match(/`([^`]+)`/)?.[1] || "")
    .filter(Boolean);
}

function previewSummary(capability: DeploymentProviderCapability): string {
  const text = capability.previewSupport.support.map((entry) => entry.text).join(" ");
  if (text.includes("not reviewed")) return "not reviewed";
  if (text.includes("explicit")) return "reviewed only with explicit preview metadata";
  return "reviewed";
}

function multiComponentSummary(capability: DeploymentProviderCapability): string {
  if (capability.multiComponentKinds.length === 0) return "single-component only";
  const parts = [`reviewed for ${codeList(capability.multiComponentKinds)}`];
  const singleOnlyKinds = capability.supportedComponentKinds.filter(
    (kind) => !capability.multiComponentKinds.includes(kind),
  );
  if (singleOnlyKinds.length > 0) {
    parts.push(`other supported kinds remain single-component only (${codeList(singleOnlyKinds)})`);
  }
  if (!capability.rolloutPolicyOmissionInPolicy.multiComponent) {
    parts.push("explicit `rollout_policy` required");
  }
  return parts.join("; ");
}

function provisionerSummary(capability: DeploymentProviderCapability): string {
  const provisioners = nestedCodes(capability.provisionerSupport, "reviewed built-in provisioner");
  return provisioners.length > 0 ? codeList(provisioners) : "none";
}

function releaseActionSummary(capability: DeploymentProviderCapability): string {
  return capability.releaseActions.routineAllowedTypes.length > 0
    ? codeList(capability.releaseActions.routineAllowedTypes)
    : "none";
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

function renderTable(rows: readonly string[][]): string {
  const escapedRows = rows.map((cells) => cells.map(escapeCell));
  const widths = escapedRows[0].map((_, index) =>
    Math.max(...escapedRows.map((cells) => cells[index]?.length || 0)),
  );
  const renderRow = (cells: readonly string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index]!)).join(" | ")} |`;
  return [
    renderRow(escapedRows[0]!),
    renderRow(widths.map((width) => "-".repeat(Math.max(3, width)))),
    ...escapedRows.slice(1).map(renderRow),
  ].join("\n");
}

function identitySummaryRow(capability: DeploymentProviderCapability): string {
  const extraIdentityFacts = [
    ...(capability.canonicalTargetIdentity.requiredReviewedProviderTargetFields || []),
    ...(capability.canonicalTargetIdentity.requiredNormalizedDerivedFields || []),
  ].map((entry) => entry.text);
  return [
    `\`${capability.provider}\``,
    formatList(capability.canonicalTargetIdentity.fields),
    formatList(extraIdentityFacts),
    formatList(capability.canonicalTargetIdentity.lockKeyShape.map((entry) => entry.text)),
  ];
}

function capabilitySummaryRow(capability: DeploymentProviderCapability): string {
  return [
    `\`${capability.provider}\``,
    codeList(capability.supportedComponentKinds),
    multiComponentSummary(capability),
    previewSummary(capability),
    codeList(capability.supportedRolloutModes),
    `\`${capability.defaultRolloutMode}\``,
    codeList(capability.builtInPublisherContract.publisherTypes),
    provisionerSummary(capability),
    releaseActionSummary(capability),
  ];
}

function identitySummaryTable(capabilities: readonly DeploymentProviderCapability[]): string {
  return renderTable([
    [
      "Provider",
      "Canonical identity fields",
      "Reviewed extra identity facts",
      "Canonical lock-key shape",
    ],
    ...capabilities.map(identitySummaryRow),
  ]);
}

function capabilitySummaryTable(capabilities: readonly DeploymentProviderCapability[]): string {
  return renderTable([
    [
      "Provider",
      "Supported component kinds",
      "Reviewed multi-component posture",
      "Preview support",
      "Supported rollout modes",
      "Default rollout mode",
      "Built-in publisher types",
      "Protected/shared built-in provisioners",
      "Protected/shared built-in `release_actions`",
    ],
    ...capabilities.map(capabilitySummaryRow),
  ]);
}

export function renderDeploymentsDesignDoc(template: string): string {
  const withIdentitySummary = replaceGeneratedBlock(
    template,
    GENERATED_IDENTITY_SUMMARY_START,
    GENERATED_IDENTITY_SUMMARY_END,
    identitySummaryTable(REVIEWED_PROVIDER_CAPABILITIES),
  );
  return replaceGeneratedBlock(
    withIdentitySummary,
    GENERATED_CAPABILITY_SUMMARY_START,
    GENERATED_CAPABILITY_SUMMARY_END,
    capabilitySummaryTable(REVIEWED_PROVIDER_CAPABILITIES),
  );
}

export async function readDeploymentsDesignDoc(): Promise<string> {
  return await fsp.readFile(DEPLOYMENTS_DESIGN_DOC_PATH, "utf8");
}

export async function writeDeploymentsDesignDoc(data: string): Promise<void> {
  await fsp.mkdir(path.dirname(DEPLOYMENTS_DESIGN_DOC_PATH), { recursive: true });
  await fsp.writeFile(DEPLOYMENTS_DESIGN_DOC_PATH, data, "utf8");
}

export function assertDeploymentsDesignDocParity(current: string): void {
  const expected = renderDeploymentsDesignDoc(current);
  if (current !== expected) {
    throw new Error(
      "deployments design doc is stale; run zx-wrapper build-tools/tools/deployments/gen-deployments-design-doc.ts",
    );
  }
}
