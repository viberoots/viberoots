import crypto from "node:crypto";

export function shortHash(s: string, n = 12): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, n);
}
