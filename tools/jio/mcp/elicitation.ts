import { emitZodWarning, scanUnsupportedFeatures } from "./schema.ts";

export const CTL_KEY = "$jio.ctl";
export const ELICIT_KEY = "$jio.ctl.elicit";
export const ELICIT_RESP_KEY = "$jio.ctl.elicit.response";

export type Reason = { keyword: string; pointer: string; note?: string };

export function sanitizeControlString(input: string): string {
  let out = String(input);
  try {
    if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  } catch {}
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  out = out.replace(/[\u0080-\u009F]/g, "");
  out = out.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  out = out.replace(/[\u2028\u2029]/g, "");
  out = out.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, "");
  try {
    out = out.replace(/\p{Cf}+/gu, "");
  } catch {}
  return out;
}

export function isControl(obj: any): boolean {
  return !!(obj && typeof obj === "object" && obj[CTL_KEY] === true);
}

export function isElicit(obj: any): boolean {
  return isControl(obj) && !!(obj as any)[ELICIT_KEY];
}

export function isElicitResponse(obj: any): boolean {
  return isControl(obj) && (obj as any)[ELICIT_RESP_KEY] !== undefined;
}

export type ElicitRequest = {
  message?: string;
  requestedSchema?: any;
  state?: any;
};

export type ElicitResponse = {
  action: "accept" | "reject" | string;
  content?: any;
  state?: any;
};

export function normalizeElicitRequest(raw: any): ElicitRequest | null {
  try {
    if (!isElicit(raw)) return null;
    const p = (raw as any)[ELICIT_KEY];
    if (!p || typeof p !== "object") return {} as any;
    const out: ElicitRequest = {};
    if (typeof p.message === "string") out.message = p.message;
    if (p.requestedSchema && typeof p.requestedSchema === "object")
      out.requestedSchema = p.requestedSchema;
    if (p.state !== undefined) out.state = p.state;
    return out;
  } catch {
    return null;
  }
}

export function normalizeElicitResponse(raw: any): ElicitResponse | null {
  try {
    if (!isElicitResponse(raw)) return null;
    const r = (raw as any)[ELICIT_RESP_KEY];
    if (!r || typeof r !== "object") return null;
    const action = typeof r.action === "string" ? r.action : "accept";
    const out: ElicitResponse = { action };
    if (r.content !== undefined) out.content = r.content;
    if (r.state !== undefined) out.state = r.state;
    return out;
  } catch {
    return null;
  }
}

export function buildElicitControl(message?: string, requestedSchema?: any): any {
  const payload: any = {};
  if (typeof message === "string" && message) payload.message = message;
  if (requestedSchema && typeof requestedSchema === "object")
    payload.requestedSchema = requestedSchema;
  return { [CTL_KEY]: true, [ELICIT_KEY]: payload };
}

export function buildElicitResponseControl(response: ElicitResponse): any {
  const { action, content, state } = response || ({} as ElicitResponse);
  const payload: any = { action: action || "accept" };
  if (content !== undefined) payload.content = content;
  if (state !== undefined) payload.state = state;
  return { [CTL_KEY]: true, [ELICIT_RESP_KEY]: payload };
}

export function validateRequestedSchemaBestEffort(schema: any): Reason[] {
  try {
    if (!schema || typeof schema !== "object") return [];
    const reasons = scanUnsupportedFeatures(schema);
    // Guard root type to object/array/primitive; note non-object roots for stricter diagnostics
    const t = (schema as any).type;
    if (!t) {
      // Accept missing type; zod conversion path will surface issues separately
    } else if (t === "array" && Array.isArray((schema as any).items)) {
      // tuple arrays unsupported in many places
      reasons.push({ keyword: "items(tuple)", pointer: "/items" });
    }
    return reasons;
  } catch {
    return [{ keyword: "exception", pointer: "", note: "validateRequestedSchema failed" }];
  }
}

export function emitRequestedSchemaWarning(tool: string, schema: any): void {
  try {
    const reasons = validateRequestedSchemaBestEffort(schema);
    if (reasons.length) emitZodWarning({ tool, reasons, schema, kind: "requested" });
  } catch {}
}
