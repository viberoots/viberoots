import crypto from "node:crypto";
import { constants } from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type CargoChecksum = {
  files: Record<string, string>;
  package: string;
};

function rejectDuplicateJSONKeys(text: string): void {
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(text[cursor] || "")) cursor += 1;
  };
  const string = (): string => {
    const start = cursor;
    if (text[cursor++] !== '"') throw new Error("expected JSON string");
    while (cursor < text.length) {
      if (text[cursor] === "\\") cursor += 2;
      else if (text[cursor++] === '"') return JSON.parse(text.slice(start, cursor));
    }
    throw new Error("unterminated JSON string");
  };
  const value = (): void => {
    whitespace();
    if (text[cursor] === "{") {
      cursor += 1;
      const keys = new Set<string>();
      whitespace();
      while (text[cursor] !== "}") {
        const key = string();
        if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        if (text[cursor++] !== ":") throw new Error("expected JSON colon");
        value();
        whitespace();
        if (text[cursor] !== ",") break;
        cursor += 1;
        whitespace();
      }
      if (text[cursor++] !== "}") throw new Error("expected JSON object end");
      return;
    }
    if (text[cursor] === "[") {
      cursor += 1;
      whitespace();
      while (text[cursor] !== "]") {
        value();
        whitespace();
        if (text[cursor] !== ",") break;
        cursor += 1;
      }
      if (text[cursor++] !== "]") throw new Error("expected JSON array end");
      return;
    }
    if (text[cursor] === '"') {
      string();
      return;
    }
    const token = text
      .slice(cursor)
      .match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!token) throw new Error("invalid JSON value");
    cursor += token[0].length;
  };
  value();
  whitespace();
  if (cursor !== text.length) throw new Error("trailing JSON input");
}

function parseChecksum(raw: string, key: string, lockedChecksum: string): CargoChecksum {
  try {
    rejectDuplicateJSONKeys(raw);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).some((field) => field !== "files" && field !== "package") ||
      !record.files ||
      typeof record.files !== "object" ||
      Array.isArray(record.files) ||
      typeof record.package !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(record.package) ||
      record.package !== lockedChecksum
    ) {
      throw new Error("invalid package/files schema or Cargo.lock package checksum");
    }
    for (const digest of Object.values(record.files)) {
      if (typeof digest !== "string" || !/^[a-fA-F0-9]{64}$/.test(digest)) {
        throw new Error("file checksum must be a SHA-256 hex digest");
      }
    }
    return { files: record.files as Record<string, string>, package: record.package };
  } catch (error) {
    throw new Error(`Cargo registry checksum metadata is invalid for ${key}: ${String(error)}`);
  }
}

function checkedRelativePath(relative: string, key: string): string {
  const canonical = path.posix.normalize(relative);
  if (
    !relative ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative) ||
    /^[A-Za-z]:/.test(relative) ||
    canonical !== relative ||
    canonical === "." ||
    canonical.startsWith("../")
  ) {
    throw new Error(`Cargo registry checksum contains an unsafe or non-canonical path for ${key}`);
  }
  return canonical;
}

async function sourceFiles(root: string, relative = ""): Promise<string[]> {
  const files: string[] = [];
  for (const item of await fsp.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${item.name}` : item.name;
    if (item.isSymbolicLink())
      throw new Error(`Cargo registry source contains a symlink: ${child}`);
    if (item.isDirectory()) files.push(...(await sourceFiles(root, child)));
    else if (item.isFile()) files.push(child);
    else throw new Error(`Cargo registry source contains a non-regular file: ${child}`);
  }
  return files;
}

export async function verifiedRegistrySourceCopy(
  originPath: string,
  key: string,
  source: string,
  lockedChecksum: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  if (!source.startsWith("registry+") || !key.endsWith(`#${source}`)) {
    throw new Error(`Cargo registry materialization identity does not match Cargo.lock: ${key}`);
  }
  const checksumName = ".cargo-checksum.json";
  const checksumRaw = await fsp.readFile(path.join(originPath, checksumName), "utf8");
  const checksum = parseChecksum(checksumRaw, key, lockedChecksum);
  const declared = new Map<string, string>();
  for (const [relative, digest] of Object.entries(checksum.files)) {
    const canonical = checkedRelativePath(relative, key);
    if (declared.has(canonical)) {
      throw new Error(`Cargo registry checksum contains duplicate normalized paths for ${key}`);
    }
    declared.set(canonical, digest.toLowerCase());
  }
  const actual = (await sourceFiles(originPath)).filter((file) => file !== checksumName).sort();
  const expected = [...declared.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Cargo registry source files do not exactly match checksum metadata: ${key}`);
  }
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-verified-"));
  try {
    for (const [relative, digest] of declared) {
      const sourceFile = path.join(originPath, ...relative.split("/"));
      const handle = await fsp.open(sourceFile, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile())
          throw new Error(`Cargo registry source is not a regular file: ${relative}`);
        const bytes = await handle.readFile();
        const actualDigest = crypto.createHash("sha256").update(bytes).digest("hex");
        if (actualDigest !== digest) {
          throw new Error(`Cargo registry source file checksum mismatch: ${relative}`);
        }
        const destination = path.join(root, ...relative.split("/"));
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.writeFile(destination, bytes, { mode: stat.mode });
      } finally {
        await handle.close();
      }
    }
    await fsp.writeFile(path.join(root, checksumName), checksumRaw);
    return { root, cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await fsp.rm(root, { recursive: true, force: true });
    throw error;
  }
}
