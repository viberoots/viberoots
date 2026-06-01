export function compareEvidenceField(
  errors: string[],
  label: string,
  field: string,
  actual: string,
  expected?: unknown,
) {
  if (String(expected || "") && actual !== String(expected)) {
    errors.push(`EC2 ASG ${label} ${field} does not match selected evidence`);
  }
}

export function sameEvidenceSet(
  errors: string[],
  label: string,
  field: string,
  actual: string[],
  expected: string[],
) {
  if (
    expected.length > 0 &&
    (actual.length !== expected.length || expected.some((value) => !actual.includes(value)))
  ) {
    errors.push(`EC2 ASG ${label} ${field} does not match selected evidence`);
  }
}

export function needsEc2AsgApply(phase: string) {
  return ["apply", "evidence", "smoke"].includes(phase);
}

export function needsEc2AsgReadOnly(phase: string) {
  return ["evidence", "smoke"].includes(phase);
}

export function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function recordText(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function recordList(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function summarizeEc2AsgRecord(value: unknown) {
  const record = recordObject(value);
  return {
    schemaVersion: recordText(record, "schemaVersion"),
    digest:
      recordText(record, "planDigest") ||
      recordText(record, "applyDigest") ||
      recordText(record, "evidenceDigest"),
  };
}
