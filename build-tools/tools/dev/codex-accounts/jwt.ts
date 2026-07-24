// JWT helpers used by the codex-accounts helper.
// Every function catches its own exceptions and returns null/undefined; never throws.

export function decodeBase64UrlToString(seg: string): string | null {
  try {
    if (typeof seg !== "string" || seg.length === 0) return null;
    const normalized = seg.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  try {
    if (typeof token !== "string" || token.length === 0) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const decoded = decodeBase64UrlToString(parts[1] || "");
    if (decoded === null) return null;
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function payloadEmail(payload: Record<string, unknown> | null | undefined): string | null {
  try {
    if (!payload) return null;
    const raw = (payload as { email?: unknown }).email;
    if (typeof raw === "string" && raw.length > 0) return raw;
    return null;
  } catch {
    return null;
  }
}

export function payloadExp(
  payload: Record<string, unknown> | null | undefined,
): number | undefined {
  try {
    if (!payload) return undefined;
    const raw = (payload as { exp?: unknown }).exp;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    return undefined;
  } catch {
    return undefined;
  }
}
