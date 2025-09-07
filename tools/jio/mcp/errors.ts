export type ErrorKind = "ConfigError" | "InvalidJson" | "Timeout" | "Generic";

export interface TaxonomyError {
  kind: ErrorKind;
  message: string;
  data?: any;
  cause?: unknown;
}

export const ExitCode: Record<ErrorKind, number> = {
  ConfigError: 78,
  InvalidJson: 65,
  Timeout: 124,
  Generic: 1,
};

export const HttpStatus: Record<ErrorKind, number> = {
  ConfigError: 400,
  InvalidJson: 422,
  Timeout: 504,
  Generic: 500,
};

export function toExitCode(kind: ErrorKind | undefined): number {
  return kind ? (ExitCode[kind] ?? 1) : 1;
}

export function toHttpStatus(kind: ErrorKind | undefined): number {
  return kind ? (HttpStatus[kind] ?? 500) : 500;
}

// Heuristic classification for existing error payloads
export function classifyError(err: any): TaxonomyError {
  try {
    // If already tagged
    if (err && typeof err === "object" && err.kind && typeof err.kind === "string") {
      return err as TaxonomyError;
    }
    const msg = String((err && (err.message || err.msg)) || err || "error");
    const lower = msg.toLowerCase();
    if (lower.includes("invalid json")) return { kind: "InvalidJson", message: msg, cause: err };
    if (lower.includes("timeout") || lower.includes("premature close"))
      return { kind: "Timeout", message: msg, cause: err };
    if (lower.includes("config") || lower.includes("spec") || lower.includes("invalid input"))
      return { kind: "ConfigError", message: msg, cause: err };
    return { kind: "Generic", message: msg, cause: err };
  } catch {
    return { kind: "Generic", message: "error", cause: err };
  }
}

export function toExitCodeFromAny(err: any): number {
  try {
    const k = err?.kind as ErrorKind | undefined;
    if (k) return toExitCode(k);
    const t = String(err?.type || "").toLowerCase();
    const m = String(err?.message || "").toLowerCase();
    if (t.includes("invalidjson") || m.includes("invalid json")) return 65;
    if (t.includes("config") || m.includes("config") || m.includes("invalid input")) return 78;
    if (t.includes("timeout") || m.includes("timeout") || m.includes("premature close")) return 124;
    return 1;
  } catch {
    return 1;
  }
}
