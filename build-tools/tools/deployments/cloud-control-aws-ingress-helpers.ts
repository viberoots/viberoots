import {
  evidenceList,
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  type EvidenceFreshnessOptions,
} from "./cloud-control-evidence-helpers";

export function requireFresh(
  value: unknown,
  label: string,
  options: EvidenceFreshnessOptions,
): string[] {
  return freshEvidenceAt(value, options) ? [] : [`${label} evidence is missing or stale`];
}

export function requireDigest(value: unknown, label: string): string[] {
  return evidenceText(value, "digest").startsWith("sha256:") ? [] : [`${label} missing digest`];
}

export function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export function matchesCertificateName(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (!pattern.startsWith("*.")) return false;
  const suffix = pattern.slice(2);
  return host.endsWith(`.${suffix}`) && host.split(".").length === suffix.split(".").length + 1;
}

export function stringSet(value: unknown, field: string): Set<string> {
  return new Set(evidenceList(value, field));
}

export function targetPort(value: unknown): number {
  const raw = evidenceObject(value).port;
  const target = evidenceObject(value).targetPort;
  if (typeof raw === "number") return raw;
  if (typeof target === "number") return target;
  return Number(raw || target || 0);
}

export function hasReviewedEvidence(value: unknown): boolean {
  return Boolean(evidenceText(value, "reviewedReference") && evidenceText(value, "digest"));
}
