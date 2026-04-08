#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

export type DeploymentOperatorPayloadClass =
  | "display_safe"
  | "redact_before_display"
  | "reference_only";

export type DeploymentOperatorVisiblePayload = {
  classification: DeploymentOperatorPayloadClass;
  redacted: boolean;
  summary: string;
  fingerprint: string;
  referencePath?: string;
};

const SECRET_PATTERN =
  /account[_-]?id|api[_-]?key|authorization|bearer|cookie|passwd|password|private[_-]?key|secret|sk_(live|test)|token|x-auth|-----begin/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9 .,:;_/#()+\-"'[\]@]+$/i;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function summarizeRedacted(text: string, fingerprint: string): string {
  return SECRET_PATTERN.test(text)
    ? `sensitive payload redacted (${fingerprint})`
    : `payload redacted (${fingerprint})`;
}

export function redactOperatorText(value: unknown): DeploymentOperatorVisiblePayload | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  const fingerprint = fingerprintValue(text);
  const isClearlySafe =
    text.length <= 160 && SAFE_TEXT_PATTERN.test(text) && !SECRET_PATTERN.test(text);
  return isClearlySafe
    ? {
        classification: "display_safe",
        redacted: false,
        summary: text,
        fingerprint,
      }
    : {
        classification: "redact_before_display",
        redacted: true,
        summary: summarizeRedacted(text, fingerprint),
        fingerprint,
      };
}

export async function createReferenceOnlyPayload(
  filePath: string,
  summary: string,
): Promise<DeploymentOperatorVisiblePayload> {
  const resolved = path.resolve(filePath);
  const raw = await fsp.readFile(resolved, "utf8");
  return {
    classification: "reference_only",
    redacted: true,
    summary,
    fingerprint: fingerprintValue(raw),
    referencePath: resolved,
  };
}

export function operatorErrorFields(value: unknown): {
  error?: string;
  errorFingerprint?: string;
} {
  const visible = redactOperatorText(value);
  if (!visible) return {};
  return visible.redacted
    ? {
        error: visible.summary,
        errorFingerprint: visible.fingerprint,
      }
    : { error: visible.summary };
}
