#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";

export type MobileGenerationDecision = "action-local" | "tracked-source";
export type MobileGenerationPlatform = "android" | "ios";

export interface MobileGeneratedFile {
  path: string;
  content: string;
}

export interface MobileGenerationEvidenceInput {
  platform: MobileGenerationPlatform;
  tauriCliDigest: string;
  sdkToolIdentities: Record<string, string>;
  sourceFixtureFiles: MobileGeneratedFile[];
  firstGeneratedFiles: MobileGeneratedFile[];
  secondGeneratedFiles: MobileGeneratedFile[];
  decision: MobileGenerationDecision;
}

export interface MobileGenerationEvidence {
  schemaVersion: "viberoots.tauri-mobile.double-generation@1";
  platform: MobileGenerationPlatform;
  pinnedCliDigest: string;
  sdkToolIdentities: Record<string, string>;
  sourceFixtureDigest: string;
  normalizedDiffDigest: string;
  actionLocalDecision: MobileGenerationDecision;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function digest(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function normalized(files: MobileGeneratedFile[]): string {
  return files
    .map((file) => ({
      path: file.path.replace(/\\/g, "/").replace(/^\.?\//, ""),
      content: file.content.replace(/\r\n/g, "\n"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.content}`)
    .join("\0");
}

function requireDigest(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`Tauri mobile evidence ${field} must be sha256`);
}

export function recordTauriMobileDoubleGenerationEvidence(
  input: MobileGenerationEvidenceInput,
): MobileGenerationEvidence {
  requireDigest(input.tauriCliDigest, "pinned CLI digest");
  for (const [name, identity] of Object.entries(input.sdkToolIdentities)) {
    if (!name || !identity)
      throw new Error("Tauri mobile evidence SDK/tool identities are required");
  }
  const first = normalized(input.firstGeneratedFiles);
  const second = normalized(input.secondGeneratedFiles);
  if (first !== second) {
    throw new Error("Tauri mobile double generation produced a non-empty normalized diff");
  }
  return {
    schemaVersion: "viberoots.tauri-mobile.double-generation@1",
    platform: input.platform,
    pinnedCliDigest: input.tauriCliDigest,
    sdkToolIdentities: Object.fromEntries(Object.entries(input.sdkToolIdentities).sort()),
    sourceFixtureDigest: digest(normalized(input.sourceFixtureFiles)),
    normalizedDiffDigest: digest(""),
    actionLocalDecision: input.decision,
  };
}
