import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { workspaceCargoHome } from "../dev/install/cargo-home";
import type { CargoPackage } from "./rust-lock";
import { cargoPackageKey } from "./rust-lock";

type FixedSourceEntry = {
  originPath?: string;
  source: string;
  checksum?: string;
  storePath?: string;
  narHash?: string;
  buildInput?: {
    source: string;
    checksum: string;
    storePath: string;
    narHash: string;
  };
};

async function fileJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseSourceMap(raw: string, label: string): Record<string, FixedSourceEntry> {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`malformed reviewed Rust fixed-source map: ${label}`, { cause: error });
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`invalid reviewed Rust fixed-source map: ${label}`);
  }
  const result: Record<string, FixedSourceEntry> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as FixedSourceEntry;
    if (
      !entry ||
      typeof entry.source !== "string" ||
      !entry.source.trim() ||
      (entry.checksum !== undefined && typeof entry.checksum !== "string")
    ) {
      throw new Error(`invalid reviewed Rust fixed-source entry: ${key}`);
    }
    result[key] = entry;
  }
  return result;
}

async function reviewedSourceEntry(
  cargoHome: string,
  pkg: CargoPackage,
): Promise<FixedSourceEntry | null> {
  const testRaw = String(process.env.NIX_RUST_TEST_RESOLVE_JSON || "").trim();
  if (testRaw) {
    return parseSourceMap(testRaw, "NIX_RUST_TEST_RESOLVE_JSON")[cargoPackageKey(pkg)] || null;
  }
  const manifest = path.join(cargoHome, "viberoots-fixed-sources.json");
  try {
    return (
      parseSourceMap(await fsp.readFile(manifest, "utf8"), manifest)[cargoPackageKey(pkg)] || null
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function validateFixedSource(origin: string, pkg: CargoPackage): Promise<void> {
  if (pkg.source.startsWith("registry+")) {
    const checksum = await fileJson(path.join(origin, ".cargo-checksum.json"));
    if (!pkg.checksum || checksum?.package !== pkg.checksum) {
      throw new Error(`reviewed Rust fixed source checksum does not match ${cargoPackageKey(pkg)}`);
    }
    return;
  }
  if (pkg.source.startsWith("git+")) {
    return;
  }
  throw new Error(`unsupported Rust fixed-source identity: ${pkg.source}`);
}

export async function resolveRustPackageOrigin(
  cargoRoot: string,
  pkg: CargoPackage,
): Promise<string> {
  const cargoHome =
    String(process.env.CARGO_HOME || "").trim() ||
    workspaceCargoHome(path.resolve(process.env.WORKSPACE_ROOT || process.cwd()));
  const entry = await reviewedSourceEntry(cargoHome, pkg);
  const authority = entry?.buildInput;
  const testAuthority = Boolean(String(process.env.NIX_RUST_TEST_RESOLVE_JSON || "").trim());
  if (
    !entry ||
    entry.source !== pkg.source ||
    (entry.checksum || "") !== (pkg.checksum || "") ||
    (!testAuthority && !entry.storePath?.startsWith("/nix/store/")) ||
    !path.isAbsolute(entry.storePath || "") ||
    !entry.narHash?.startsWith("sha256-") ||
    !authority ||
    authority.source !== pkg.source ||
    (authority.checksum || "") !== (pkg.checksum || "") ||
    authority.storePath !== entry.storePath ||
    authority.narHash !== entry.narHash
  ) {
    throw new Error(
      `exact Nix fixed source is unavailable for ${cargoPackageKey(pkg)}; refresh the reviewed Rust fixed-source map`,
    );
  }
  const origin = path.resolve(authority.storePath);
  if (!fs.existsSync(origin)) {
    throw new Error(`reviewed Rust fixed source is unavailable: ${origin}`);
  }
  const canonical = fs.realpathSync.native(origin);
  await validateFixedSource(canonical, pkg);
  if (canonical === fs.realpathSync.native(cargoRoot)) {
    throw new Error("local path dependencies are reviewed source and cannot be patch-pkg targets");
  }
  return canonical;
}
