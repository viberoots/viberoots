import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";

type PathFlakeMetadata = {
  lastModified?: number;
  narHash?: string;
};

async function readPathFlakeMetadata(inputPath: string): Promise<PathFlakeMetadata> {
  const canonicalInputPath = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await $({
    stdio: "pipe",
  })`nix flake prefetch --json ${`path:${canonicalInputPath}`}`.nothrow();
  if (prefetched.exitCode === 0) {
    const parsed = JSON.parse(String(prefetched.stdout || "{}"));
    const locked = parsed?.locked || {};
    return {
      lastModified: typeof locked.lastModified === "number" ? locked.lastModified : undefined,
      narHash: typeof locked.narHash === "string" ? locked.narHash : undefined,
    };
  }
  const out = await $({
    stdio: "pipe",
  })`nix flake metadata --json ${`path:${canonicalInputPath}`} --no-write-lock-file`;
  const parsed = JSON.parse(String(out.stdout || "{}"));
  const locked = parsed?.locked || {};
  const narHash =
    typeof locked.narHash === "string"
      ? locked.narHash
      : String(
          (
            await $({
              stdio: "pipe",
            })`nix hash path --sri ${canonicalInputPath}`
          ).stdout || "",
        ).trim();
  return {
    lastModified: typeof locked.lastModified === "number" ? locked.lastModified : undefined,
    narHash: narHash || undefined,
  };
}

function rewriteLocalPathLockEntry(
  entry: unknown,
  pathValue: string,
  metadata?: PathFlakeMetadata,
): boolean {
  if (!entry || typeof entry !== "object") return false;
  const node = entry as { type?: unknown; path?: unknown; url?: unknown };
  const rawPath =
    node.type === "path"
      ? String(node.path || "")
      : node.type === "git" && String(node.url || "").startsWith("file:")
        ? String(node.url || "").replace(/^file:/, "")
        : "";
  if (!rawPath || path.basename(rawPath) !== "viberoots") return false;
  const mutableNode = node as {
    lastModified?: number;
    lastModifiedDate?: string;
    narHash?: string;
    path: unknown;
    rev?: string;
    revCount?: number;
    type: unknown;
    url?: string;
  };
  mutableNode.type = "path";
  mutableNode.path = pathValue;
  if (metadata?.lastModified) mutableNode.lastModified = metadata.lastModified;
  if (metadata?.narHash) mutableNode.narHash = metadata.narHash;
  delete mutableNode.lastModifiedDate;
  delete mutableNode.rev;
  delete mutableNode.revCount;
  delete mutableNode.url;
  return true;
}

export async function rewriteStageViberootsInput(stageDir: string): Promise<string[]> {
  const touched: string[] = [];
  const flakePath = path.join(stageDir, ".viberoots", "workspace", "flake.nix");
  const flakeText = await fsp.readFile(flakePath, "utf8").catch(() => "");
  if (flakeText) {
    const next = flakeText.replace(
      /(\bviberoots\.url\s*=\s*)"[^"]*"/,
      (_match, prefix: string) => `${prefix}"path:./viberoots"`,
    );
    if (next !== flakeText) {
      await fsp.writeFile(flakePath, next, "utf8");
      touched.push(path.join(".viberoots", "workspace", "flake.nix"));
    }
  }

  const lockPath = path.join(stageDir, ".viberoots", "workspace", "flake.lock");
  const lockText = await fsp.readFile(lockPath, "utf8").catch(() => "");
  if (lockText) {
    const metadata = await readPathFlakeMetadata(path.join(stageDir, "viberoots"));
    let lock: any;
    try {
      lock = JSON.parse(lockText);
    } catch {
      lock = null;
    }
    const inputName = lock?.nodes?.root?.inputs?.viberoots || "viberoots";
    const node = lock?.nodes?.[inputName] || lock?.nodes?.viberoots || lock?.nodes?.viberootsInput;
    if (node && typeof node === "object") {
      const lockedChanged = rewriteLocalPathLockEntry(node.locked, "./viberoots", metadata);
      const originalChanged = rewriteLocalPathLockEntry(node.original, "./viberoots");
      if (lockedChanged || originalChanged) {
        await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
        touched.push(path.join(".viberoots", "workspace", "flake.lock"));
      }
    }
  }
  return touched;
}
