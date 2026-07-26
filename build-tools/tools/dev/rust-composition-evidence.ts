import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";

type Entry = {
  label: string;
  cargo_root: string;
  member_manifest: string;
  cargo_lock: string;
  lock_identity: string;
  public_crate: string;
  crate_type: string;
  host_role: string;
  generated_outputs: string[];
  packageName: string;
  manifestSource: string;
};

function packageIdentity(source: string, expectedName: string): string {
  let inPackage = false;
  let name = "";
  let version = "";
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inPackage = line === "[package]";
      continue;
    }
    if (!inPackage) continue;
    const field = line.match(/^(name|version)\s*=\s*(["'])(.*?)\2\s*$/);
    if (field?.[1] === "name") name = field[3];
    if (field?.[1] === "version") version = field[3];
  }
  if (!name || !version) {
    throw new Error("Rust composition member manifest requires package.name and package.version");
  }
  if (name !== expectedName) {
    throw new Error(`Rust composition package ${expectedName} disagrees with manifest ${name}`);
  }
  return `${name}@${version}`;
}

function normalizedLabel(value: string): string {
  return value.replace(/\s+\([^)]*\)$/, "").replace(/^root\/\//, "//");
}

function entries(tokens: string[]): Entry[] {
  const result: Entry[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "--rust-composition-entry") continue;
    const values = tokens.slice(index + 1, index + 12);
    const outputCount = Number(values[10]);
    if (values.length !== 11 || !Number.isSafeInteger(outputCount) || outputCount < 0) {
      throw new Error("invalid --rust-composition-entry");
    }
    const generated_outputs = tokens.slice(index + 12, index + 12 + outputCount);
    result.push({
      label: normalizedLabel(values[0]),
      cargo_root: values[1],
      member_manifest: values[2],
      cargo_lock: values[3],
      lock_identity: values[4],
      public_crate: values[5],
      crate_type: values[6],
      host_role: values[7],
      packageName: values[8],
      generated_outputs,
      manifestSource: values[9],
    });
    index += 11 + outputCount;
  }
  return result;
}

export async function rustCompositionEvidence(
  tokens: string[],
): Promise<{ manifest: Record<string, unknown>[]; digest: string } | undefined> {
  const byRoot = new Map<string, Entry>();
  for (const entry of entries(tokens)) byRoot.set(entry.cargo_root, entry);
  if (byRoot.size === 0) return undefined;
  const manifest = await Promise.all(
    [...byRoot.values()]
      .sort((left, right) => left.cargo_root.localeCompare(right.cargo_root))
      .map(async (entry) => ({
        cargo_lock: entry.cargo_lock,
        cargo_root: entry.cargo_root,
        crate_type: entry.crate_type,
        generated_outputs: entry.generated_outputs,
        host_role: entry.host_role,
        label: entry.label,
        lock_identity: entry.lock_identity,
        member_manifest: entry.member_manifest,
        package_id: packageIdentity(
          await fsp.readFile(entry.manifestSource, "utf8"),
          entry.packageName,
        ),
        public_crate: entry.public_crate,
      })),
  );
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return { manifest, digest };
}
