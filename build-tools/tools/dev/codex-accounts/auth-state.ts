import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { decodeJwtPayload, payloadEmail, payloadExp } from "./jwt";
import type { AuthInspection } from "./types";

const EMPTY: AuthInspection = {
  mode: null,
  status: "missing",
  usable: false,
  email: null,
  expired: null,
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function inspectAuthentication(accountPath: string): Promise<AuthInspection> {
  let content: string;
  try {
    content = await fsp.readFile(path.join(accountPath, "auth.json"), "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return EMPTY;
    return { ...EMPTY, status: "corrupt" };
  }
  if (content.trim().length === 0) return { ...EMPTY, status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ...EMPTY, status: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY, status: "corrupt" };
  }

  const record = parsed as Record<string, unknown>;
  if (record.auth_mode === "apikey") {
    const usable = nonEmptyString(record.OPENAI_API_KEY);
    return {
      mode: usable ? "api-key" : null,
      status: usable ? "usable" : "unsupported",
      usable,
      email: null,
      expired: usable ? false : null,
    };
  }
  if (record.auth_mode !== "chatgpt") {
    return { ...EMPTY, status: "unsupported" };
  }

  const tokens =
    record.tokens && typeof record.tokens === "object" && !Array.isArray(record.tokens)
      ? (record.tokens as Record<string, unknown>)
      : null;
  const idToken = tokens?.id_token;
  const payload = nonEmptyString(idToken) ? decodeJwtPayload(idToken) : null;
  const hasSessionToken =
    nonEmptyString(tokens?.access_token) || nonEmptyString(tokens?.refresh_token);
  const usable = payload !== null && hasSessionToken;
  const exp = payloadExp(payload);
  return {
    mode: usable ? "chatgpt" : null,
    status: usable ? "usable" : "unsupported",
    usable,
    email: usable ? payloadEmail(payload) : null,
    expired: usable && typeof exp === "number" ? exp * 1000 < Date.now() : usable ? false : null,
  };
}

export async function hasConfig(accountPath: string): Promise<boolean> {
  try {
    return (await fsp.stat(path.join(accountPath, "config.toml"))).isFile();
  } catch {
    return false;
  }
}
