export type SkipReason =
  | "missing-language"
  | "missing-required-files"
  | "stale-glue"
  | "not-applicable";

export function skipMessage(reason: SkipReason, details?: string): string {
  const base = "[skip]";
  switch (reason) {
    case "missing-language":
      return `${base} language not enabled in this checkout${details ? `: ${details}` : ""}`;
    case "missing-required-files":
      return `${base} required files missing${details ? `: ${details}` : ""}`;
    case "stale-glue":
      return `${base} glue missing or stale${details ? `: ${details}` : ""}`;
    case "not-applicable":
    default:
      return `${base} not applicable${details ? `: ${details}` : ""}`;
  }
}

export function printSkip(reason: SkipReason, details?: string) {
  console.warn(skipMessage(reason, details));
}
