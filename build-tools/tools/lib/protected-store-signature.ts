import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { REVIEWED_EVIDENCE_PUBLIC_KEY } from "./artifact-nix-policy";

export type ProtectedStoreSignatureRunner = (
  args: string[],
) => Promise<{ stdout?: string; stderr?: string }>;

const STORE_ROOT = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u;

export async function assertProtectedSigningKeyFile(file: string): Promise<string> {
  const candidate = String(file || "").trim();
  if (!path.isAbsolute(candidate) || candidate.startsWith("/nix/store/")) {
    throw new Error("protected evidence signing key must be an external absolute path");
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("protected evidence signing key must be a nofollow regular file");
  }
  const stat = await handle.stat().finally(async () => await handle.close());
  if (!stat.isFile()) {
    throw new Error("protected evidence signing key must be a nofollow regular file");
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error("protected evidence signing key must have owner-only mode 0600");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("protected evidence signing key must be owned by the current administrator");
  }
  return candidate;
}

export function protectedStoreRoot(value: string): string {
  const candidate = String(value || "").trim();
  const root = candidate.endsWith(".json") ? path.dirname(candidate) : candidate;
  if (!STORE_ROOT.test(root)) {
    throw new Error("protected evidence must use an exact Nix store root");
  }
  return root;
}

export function protectedStoreSignatureVerificationArgs(value: string): string[] {
  return [
    "store",
    "verify",
    "--sigs-needed",
    "1",
    "--option",
    "trusted-public-keys",
    REVIEWED_EVIDENCE_PUBLIC_KEY,
    protectedStoreRoot(value),
  ];
}

export function protectedStoreEnsureArgs(value: string): string[] {
  return ["store", "ensure-path", protectedStoreRoot(value)];
}

export async function ensureProtectedStorePath(
  value: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<string> {
  const root = protectedStoreRoot(value);
  await runNix(protectedStoreEnsureArgs(root));
  return root;
}

export async function verifyProtectedStoreSignature(
  value: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<string> {
  const root = protectedStoreRoot(value);
  await runNix(protectedStoreSignatureVerificationArgs(root));
  return root;
}

export async function verifyProtectedStoreClosureSignature(
  value: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<string> {
  const root = protectedStoreRoot(value);
  await runNix([
    "store",
    "verify",
    "--recursive",
    "--sigs-needed",
    "1",
    "--option",
    "trusted-public-keys",
    REVIEWED_EVIDENCE_PUBLIC_KEY,
    root,
  ]);
  return root;
}

export async function signAndVerifyProtectedStore(
  value: string,
  keyFile: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<string> {
  const root = protectedStoreRoot(value);
  const protectedKeyFile = await assertProtectedSigningKeyFile(keyFile);
  await runNix(["store", "sign", "--key-file", protectedKeyFile, root]);
  await assertProtectedSigningKeyFile(protectedKeyFile);
  return await verifyProtectedStoreSignature(root, runNix);
}

export async function signAndVerifyProtectedStoreClosure(
  value: string,
  keyFile: string,
  runNix: ProtectedStoreSignatureRunner,
): Promise<string> {
  const root = protectedStoreRoot(value);
  const protectedKeyFile = await assertProtectedSigningKeyFile(keyFile);
  await runNix(["store", "sign", "--recursive", "--key-file", protectedKeyFile, root]);
  await assertProtectedSigningKeyFile(protectedKeyFile);
  return await verifyProtectedStoreClosureSignature(root, runNix);
}
