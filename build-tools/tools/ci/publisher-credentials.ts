import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CacheBackendKind } from "./cache-manifest";

export type PublisherCredentials = Readonly<Record<string, string>>;

const BACKEND_KEYS: Partial<Record<CacheBackendKind, readonly string[]>> = {
  attic: ["ATTIC_TOKEN"],
  cachix: ["CACHIX_AUTH_TOKEN", "CACHIX_SIGNING_KEY"],
};

export function redactPublisherOutput(value: string, credentials: PublisherCredentials): string {
  let redacted = value;
  const secrets = [...new Set(Object.values(credentials).filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  for (const secret of secrets) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted;
}

export async function readPublisherCredentials(opts: {
  backend: CacheBackendKind;
  file: string;
  required: boolean;
}): Promise<PublisherCredentials> {
  const allowed = BACKEND_KEYS[opts.backend];
  if (!allowed) {
    if (opts.file) {
      throw new Error(`publisher credentials are not supported for backend ${opts.backend}`);
    }
    return {};
  }
  if (!opts.file) {
    if (opts.required) {
      throw new Error(`live ${opts.backend} publication requires --publisher-env-file`);
    }
    return {};
  }
  if (!path.isAbsolute(opts.file)) {
    throw new Error("publisher credential file must be absolute");
  }

  const handle = await fsp.open(opts.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("publisher credential file must be a regular file");
    if ((stat.mode & 0o7777) !== 0o600) {
      throw new Error("publisher credential file must have mode 0600");
    }
    const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("publisher credential file must contain a JSON object");
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!allowed.includes(key)) {
        throw new Error("publisher credential file contains an unsupported key");
      }
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`publisher credential ${key} must be a nonempty string`);
      }
      result[key] = value;
    }
    if (opts.required && !allowed.some((key) => result[key])) {
      throw new Error(`live ${opts.backend} publication requires a backend credential`);
    }
    return result;
  } finally {
    await handle.close();
  }
}
