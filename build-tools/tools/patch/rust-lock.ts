import crypto from "node:crypto";
import * as fsp from "node:fs/promises";

export type CargoPackage = {
  name: string;
  version: string;
  source: string;
  checksum: string;
};

function tomlString(line: string, field: string): string | null {
  const pattern = `^\\s*${field}\\s*=\\s*(?:"([^"\\\\]*)"|'([^']*)')\\s*` + "$";
  const match = line.match(new RegExp(pattern));
  return match ? (match[1] ?? match[2] ?? "") : null;
}

export async function readCargoPackages(lockFile: string): Promise<CargoPackage[]> {
  const text = await fsp.readFile(lockFile, "utf8");
  const packages: CargoPackage[] = [];
  let current: CargoPackage | null = null;
  let packageIndex = 0;
  const finish = () => {
    if (!current) return;
    packageIndex += 1;
    if (!current.name || !current.version) {
      throw new Error(
        `malformed Cargo.lock package #${packageIndex}: name and version are required`,
      );
    }
    if (current.source.startsWith("registry+") && !current.checksum) {
      throw new Error(
        `malformed Cargo.lock package ${current.name}@${current.version}: registry checksum is required`,
      );
    }
    packages.push(current);
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[\[package\]\]\s*$/.test(line)) {
      finish();
      current = { name: "", version: "", source: "", checksum: "" };
      continue;
    }
    if (!current) continue;
    for (const field of ["name", "version", "source", "checksum"] as const) {
      const value = tomlString(line, field);
      if (value !== null) current[field] = value;
    }
  }
  finish();
  const identities = packages.map(cargoPackageKey);
  if (new Set(identities).size !== identities.length) {
    throw new Error("malformed Cargo.lock: duplicate package source identities");
  }
  return packages;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

export async function cargoManifestAlias(manifest: string, requested: string): Promise<string> {
  const text = await fsp.readFile(manifest, "utf8");
  let dependencySection = false;
  let dependencyTableAlias = "";
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      const dependency = section[1]?.match(
        /^(?:(?:target\..+|workspace)\.)?(?:dev-|build-)?dependencies(?:\.([A-Za-z0-9_-]+))?$/,
      );
      dependencySection = Boolean(dependency);
      dependencyTableAlias = dependency?.[1] ?? "";
      continue;
    }
    if (!dependencySection) continue;
    if (dependencyTableAlias) {
      if (dependencyTableAlias !== requested) continue;
      const packageField = tomlString(line, "package");
      if (packageField !== null) return packageField;
      continue;
    }
    const assignment = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!assignment || assignment[1] !== requested) continue;
    const packageField = assignment[2]?.match(/\bpackage\s*=\s*("[^"]*"|'[^']*')/);
    return packageField ? unquote(packageField[1] || "") : requested;
  }
  return requested;
}

export function cargoSourceHash(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

export function cargoPackageKey(pkg: CargoPackage): string {
  return `${pkg.name.toLowerCase()}@${pkg.version}#${pkg.source}`;
}

export function selectCargoPackage(
  packages: CargoPackage[],
  requested: string,
  version = "",
  source = "",
): CargoPackage {
  const matches = packages.filter(
    (pkg) =>
      pkg.name.toLowerCase() === requested.toLowerCase() &&
      (!version || pkg.version === version) &&
      (!source || pkg.source === source || cargoSourceHash(pkg.source) === source),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new Error(`crate is not present in the selected Cargo.lock: ${requested}`);
  }
  const identities = matches
    .map((pkg) => `${pkg.name}@${pkg.version} --source ${cargoSourceHash(pkg.source)}`)
    .sort();
  throw new Error(
    `crate request is ambiguous; pass --version and --source:\n${identities.join("\n")}`,
  );
}
