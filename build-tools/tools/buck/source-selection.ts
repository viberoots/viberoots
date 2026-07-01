#!/usr/bin/env zx-wrapper
import { normalizeNixAttr } from "../lib/provider-names";

export type NixpkgPins = Record<string, Record<string, string>>;

export function normalizeNixpkgPins(raw: unknown): NixpkgPins {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: NixpkgPins = {};
  for (const [attr, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const normalizedAttr = normalizeNixAttr(attr);
    if (!normalizedAttr) continue;
    const pin: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof v === "string") pin[k] = v;
    }
    out[normalizedAttr] = pin;
  }
  return out;
}

export function normalizeNixpkgsProfile(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : "default";
}
