import fs from "node:fs";

const MAX_PROOF_BYTES = 1024 * 1024;
const MAX_PROOF_FD = 1024;

export type ReviewedNixConfigProof = {
  token: string;
  policy: "auto" | "strict";
  requiredSubstituters: string[];
  optionalSubstituters: string[];
  config: string;
};

function proofFd(env: NodeJS.ProcessEnv): number {
  const raw = String(env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD || "");
  if (!/^[0-9]+$/u.test(raw)) return -1;
  const fd = Number(raw);
  return Number.isSafeInteger(fd) && fd >= 10 && fd <= MAX_PROOF_FD ? fd : -1;
}

function readBoundedProof(fd: number): string {
  const stat = fs.fstatSync(fd);
  if (
    (!stat.isFile() && !stat.isFIFO()) ||
    (stat.isFile() && (stat.size < 2 || stat.size > MAX_PROOF_BYTES))
  ) {
    return "";
  }
  const proof = Buffer.alloc(MAX_PROOF_BYTES + 1);
  const bytesRead = fs.readSync(fd, proof, 0, proof.length, null);
  if (bytesRead < 2 || bytesRead > MAX_PROOF_BYTES) return "";
  const encoded = proof.subarray(0, bytesRead).toString("utf8");
  return encoded.endsWith("\n") ? encoded.slice(0, -1) : "";
}

function splitWords(value: string): string[] {
  return [...new Set(value.split(/\s+/u).filter(Boolean))];
}

function parseProof(payload: string): ReviewedNixConfigProof | null {
  const fields: string[] = [];
  let remaining = payload;
  for (let index = 0; index < 5; index += 1) {
    const newline = remaining.indexOf("\n");
    if (newline < 0) return null;
    fields.push(remaining.slice(0, newline));
    remaining = remaining.slice(newline + 1);
  }
  if (fields[0] !== "vbr-nix-cache-review@1") return null;
  if (fields[2] !== "auto" && fields[2] !== "strict") return null;
  const requiredSubstituters = splitWords(fields[3]);
  return {
    token: fields[1],
    policy: fields[2],
    requiredSubstituters,
    optionalSubstituters: splitWords(fields[4]).filter(
      (entry) => !requiredSubstituters.includes(entry),
    ),
    config: remaining,
  };
}

export function consumeReviewedNixConfigProof(
  env: NodeJS.ProcessEnv,
): ReviewedNixConfigProof | null {
  const fd = proofFd(env);
  delete env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD;
  delete env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN;
  if (fd < 0) return null;
  try {
    return parseProof(readBoundedProof(fd));
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}
