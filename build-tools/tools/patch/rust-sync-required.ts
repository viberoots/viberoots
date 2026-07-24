import * as fsp from "node:fs/promises";
import path from "node:path";
import { encodeForPatchFilename } from "../lib/providers";
import {
  cargoSourceHash,
  readCargoPackages,
  selectCargoPackage,
  type CargoPackage,
} from "./rust-lock";
import { rustPatchDir } from "./rust-patch-dir";
import { resolveRustCargoRoot } from "./rust-root";

type RequiredPatch = { name: string; version?: string; source?: string };
type RequiredPatchMetadata = {
  schema: "viberoots.rust-required-patches.v1";
  required: RequiredPatch[];
};

export function rustPatchFilename(name: string, version: string, source: string): string {
  return `${encodeForPatchFilename(name)}@${version}--${cargoSourceHash(source)}.patch`;
}

async function readRequiredMetadata(patchDir: string): Promise<RequiredPatch[]> {
  const file = path.join(patchDir, "required-patches.json");
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let parsed: RequiredPatchMetadata;
  try {
    parsed = JSON.parse(raw) as RequiredPatchMetadata;
  } catch (error) {
    throw new Error(`malformed Rust required-patch metadata: ${file}`, { cause: error });
  }
  if (
    parsed.schema !== "viberoots.rust-required-patches.v1" ||
    !Array.isArray(parsed.required) ||
    parsed.required.some(
      (entry) =>
        !entry ||
        typeof entry.name !== "string" ||
        !entry.name.trim() ||
        (entry.version !== undefined && typeof entry.version !== "string") ||
        (entry.source !== undefined && typeof entry.source !== "string"),
    )
  ) {
    throw new Error(`invalid Rust required-patch metadata: ${file}`);
  }
  return parsed.required;
}

function resolveRequired(
  packages: CargoPackage[],
  required: RequiredPatch[],
): { packages: CargoPackage[]; ambiguous: string[] } {
  const resolved: CargoPackage[] = [];
  const ambiguous: string[] = [];
  for (const entry of required) {
    try {
      resolved.push(
        selectCargoPackage(packages, entry.name, entry.version || "", entry.source || ""),
      );
    } catch (error) {
      ambiguous.push(
        `${entry.name}${entry.version ? `@${entry.version}` : ""}${entry.source ? `#${entry.source}` : ""}: ${(error as Error).message}`,
      );
    }
  }
  const byIdentity = new Map(
    resolved.map((pkg) => [`${pkg.name}\0${pkg.version}\0${pkg.source}`, pkg] as const),
  );
  if (byIdentity.size !== resolved.length) {
    ambiguous.push("required-patches.json contains duplicate locked identities");
  }
  return {
    packages: [...byIdentity.values()].sort((a, b) =>
      `${a.name}\0${a.version}\0${a.source}`.localeCompare(`${b.name}\0${b.version}\0${b.source}`),
    ),
    ambiguous: ambiguous.sort(),
  };
}

async function writePlaceholder(patchDir: string, pkg: CargoPackage): Promise<void> {
  const filename = rustPatchFilename(pkg.name, pkg.version, pkg.source);
  const destination = path.join(patchDir, filename);
  try {
    await fsp.access(destination);
    return;
  } catch {}
  await fsp.mkdir(patchDir, { recursive: true });
  await fsp.writeFile(
    destination,
    [
      `# placeholder for required Rust patch: ${pkg.name}@${pkg.version}`,
      `# locked source: ${pkg.source}`,
      "# replace with an actual canonical -p1 unified diff",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function runRustSyncRequired(args: string[]): Promise<void> {
  const cargoRoot = await resolveRustCargoRoot(args);
  const patchDir = await rustPatchDir(cargoRoot, args);
  const packages = await readCargoPackages(path.join(cargoRoot, "Cargo.lock"));
  const required = resolveRequired(packages, await readRequiredMetadata(patchDir));
  const applicable = new Set(
    packages
      .filter((pkg) => pkg.source)
      .map((pkg) => rustPatchFilename(pkg.name, pkg.version, pkg.source)),
  );
  const inventory = (await fsp.readdir(patchDir).catch(() => []))
    .filter((name) => name.endsWith(".patch"))
    .sort();
  const present = new Set(inventory);
  let missing = required.packages
    .map((pkg) => rustPatchFilename(pkg.name, pkg.version, pkg.source))
    .filter((name) => !present.has(name))
    .sort();
  const stale = inventory.filter((name) => !applicable.has(name));

  if (args.includes("--write-placeholders") && required.ambiguous.length === 0) {
    for (const pkg of required.packages) await writePlaceholder(patchDir, pkg);
    missing = [];
  }
  const sections = [
    required.ambiguous.length
      ? `ambiguous required Rust patches:\n${required.ambiguous.join("\n")}`
      : "",
    missing.length ? `missing required Rust patches:\n${missing.join("\n")}` : "",
    stale.length ? `stale Rust patches:\n${stale.join("\n")}` : "",
  ].filter(Boolean);
  if (sections.length > 0 && !args.includes("--write-placeholders")) {
    throw new Error(sections.join("\n"));
  }
  if (required.ambiguous.length > 0 || stale.length > 0) {
    throw new Error(sections.join("\n"));
  }
  console.log(
    `Rust patch inventory is synchronized (required=${required.packages.length}, present=${inventory.length}, missing=${missing.length})`,
  );
}
