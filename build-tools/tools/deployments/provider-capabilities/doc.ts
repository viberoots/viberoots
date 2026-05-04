#!/usr/bin/env zx-wrapper
import fsp from "node:fs/promises";
import path from "node:path";
import { REVIEWED_PROVIDER_CAPABILITIES } from "./registry";
import { renderProviderCapabilityEntries } from "./render";

export const PROVIDER_CAPABILITIES_DOC_PATH = "docs/deployment-provider-capabilities.md";
export const GENERATED_PROVIDER_CAPABILITIES_START =
  "<!-- BEGIN GENERATED PROVIDER CAPABILITIES -->";
export const GENERATED_PROVIDER_CAPABILITIES_END = "<!-- END GENERATED PROVIDER CAPABILITIES -->";

function replaceGeneratedBlock(template: string, renderedEntries: string): string {
  const start = template.indexOf(GENERATED_PROVIDER_CAPABILITIES_START);
  const end = template.indexOf(GENERATED_PROVIDER_CAPABILITIES_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`missing provider-capability doc markers in ${PROVIDER_CAPABILITIES_DOC_PATH}`);
  }
  const before = template.slice(0, start + GENERATED_PROVIDER_CAPABILITIES_START.length);
  const after = template.slice(end);
  return `${before}\n\n${renderedEntries}\n\n${after}`;
}

export function renderProviderCapabilitiesDoc(template: string): string {
  return replaceGeneratedBlock(
    template,
    renderProviderCapabilityEntries(REVIEWED_PROVIDER_CAPABILITIES),
  );
}

export async function readProviderCapabilitiesDoc(): Promise<string> {
  return fsp.readFile(PROVIDER_CAPABILITIES_DOC_PATH, "utf8");
}

export async function writeProviderCapabilitiesDoc(data: string): Promise<void> {
  await fsp.mkdir(path.dirname(PROVIDER_CAPABILITIES_DOC_PATH), { recursive: true });
  await fsp.writeFile(PROVIDER_CAPABILITIES_DOC_PATH, data, "utf8");
}

export function assertProviderCapabilitiesDocParity(current: string): void {
  const expected = renderProviderCapabilitiesDoc(current);
  if (current !== expected) {
    throw new Error(
      "provider capabilities doc is stale; run zx-wrapper build-tools/tools/deployments/gen-provider-capabilities-doc.ts",
    );
  }
}
