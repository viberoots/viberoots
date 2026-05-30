export type EvidenceFreshnessOptions = {
  maxAgeMinutes: number;
  nowMs?: number;
};

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{24,}/i,
  /(?:secret|token|password|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i,
  /postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const INVALID_SOURCE_PATTERNS = [
  /\bdashboard[- ]only\b/i,
  /\braw[- ]iac[- ]only\b/i,
  /\braw\s+iac\s+state\b/i,
  /\braw terraform state\b/i,
  /\bmanual notes?\b/i,
  /\bsupport[- ]?(?:ticket|case)\b/i,
];

export function evidenceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function isEvidenceObject(value: unknown): value is Record<string, unknown> {
  return Object.keys(evidenceObject(value)).length > 0;
}

export function evidenceText(value: unknown, field: string): string {
  const raw = evidenceObject(value)[field];
  return typeof raw === "string" ? raw.trim() : "";
}

export function evidenceList(value: unknown, field: string): string[] {
  const raw = evidenceObject(value)[field];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

export function freshEvidenceAt(value: unknown, options: EvidenceFreshnessOptions): boolean {
  const checkedAt = evidenceText(value, "checkedAt");
  const parsed = Date.parse(checkedAt);
  if (!Number.isFinite(parsed)) return false;
  const nowMs = options.nowMs ?? Date.now();
  return nowMs - parsed <= options.maxAgeMinutes * 60_000;
}

export function evidenceSourceErrors(value: unknown, path = "evidence"): string[] {
  const errors: string[] = [];
  visitEvidence(value, path, (current, currentPath) => {
    const supportPrerequisiteEvidenceRef = /\.supportPrerequisites\[\d+\]\.evidenceRef$/.test(
      currentPath,
    );
    if (
      typeof current === "string" &&
      !supportPrerequisiteEvidenceRef &&
      INVALID_SOURCE_PATTERNS.some((item) => item.test(current))
    ) {
      errors.push(
        `${currentPath} must be structured evidence, not dashboard/raw-IaC notes or support-ticket text`,
      );
    }
    if (
      currentPath.match(
        /(?:dashboard|rawIac|rawTerraformState|terraformState|opentofuState|tofuState|iacState|manualNote|supportTicket|supportCase)/i,
      )
    ) {
      errors.push(`${currentPath} is not protected/shared readiness evidence`);
    }
  });
  return errors;
}

export function evidenceSecretErrors(value: unknown, path = "evidence"): string[] {
  const errors: string[] = [];
  visitEvidence(value, path, (current, currentPath) => {
    if (typeof current === "string" && SECRET_PATTERNS.some((item) => item.test(current))) {
      errors.push(`${currentPath} appears to contain secret material`);
    }
  });
  return errors;
}

export function redactEvidenceValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactEvidenceValue);
  const object = evidenceObject(value);
  if (Object.keys(object).length === 0) return value;
  return Object.fromEntries(
    Object.entries(object).map(([key, current]) => [key, redactEvidenceValue(current)]),
  );
}

function redactText(value: string): string {
  return value
    .replace(/arn:aws[a-z-]*:[^:\s]+:[^:\s]*:\d{12}:[^\s,;]+/g, "arn:aws:<redacted>")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi, "<hostname:redacted>")
    .slice(0, 512);
}

function visitEvidence(
  value: unknown,
  path: string,
  visitor: (value: unknown, path: string) => void,
): void {
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitEvidence(item, `${path}[${index}]`, visitor));
    return;
  }
  const object = evidenceObject(value);
  for (const [key, current] of Object.entries(object)) {
    visitEvidence(current, `${path}.${key}`, visitor);
  }
}
