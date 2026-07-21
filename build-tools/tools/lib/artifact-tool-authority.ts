import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";

function literalArtifactToolsRoot(rootValue: string, label: string): string {
  const root = String(rootValue || "").trim();
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(root)) {
    throw new Error(`${label} must be a literal Nix store directory: ${root || "<empty>"}`);
  }
  let stat: fs.Stats;
  let real: string;
  try {
    stat = fs.lstatSync(root);
    real = fs.realpathSync(root);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${root}`, { cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || real !== root) {
    throw new Error(`${label} must not use a mutable or indirect path: ${root}`);
  }
  return root;
}

function scopedManifestCandidates(workspaceRoot: string): string[] {
  const absolute = path.resolve(workspaceRoot);
  return [path.join(absolute, ".viberoots", "workspace", "toolchain-paths.json")];
}

function readScopedManifest(workspaceRoot: string): {
  file: string;
  parsed: { artifactTools?: { root?: unknown } } | null;
} {
  let firstFile = "";
  for (const candidate of scopedManifestCandidates(workspaceRoot)) {
    if (!firstFile) firstFile = candidate;
    let text: string;
    try {
      text = fs.readFileSync(candidate, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(
        `canonical artifact tool authority is unreadable at ${candidate}; run u && i`,
        { cause: error },
      );
    }
    try {
      return { file: candidate, parsed: JSON.parse(text) };
    } catch (error) {
      throw new Error(`canonical artifact tool authority is invalid at ${candidate}; run u && i`, {
        cause: error,
      });
    }
  }
  return { file: firstFile, parsed: null };
}

export const REQUIRED_ARTIFACT_TOOL_BINARIES = [
  "bash",
  "buck2",
  "git",
  "nix",
  "node",
  "pnpm",
  "python3",
  "rsync",
  "sort",
  "uv",
  "zx-wrapper",
  "yq",
] as const;

export function validateArtifactToolsRoot(root: string, context: string): string {
  const validated = literalArtifactToolsRoot(root, context);
  for (const tool of REQUIRED_ARTIFACT_TOOL_BINARIES) {
    try {
      fs.accessSync(path.join(validated, "bin", tool), fs.constants.X_OK);
    } catch (error) {
      throw new Error(
        `canonical artifact tool authority is missing ${tool}: ${validated}; run u && i`,
        { cause: error },
      );
    }
  }
  return validated;
}

export function canonicalArtifactToolsRoot(workspaceRoot: string, assertedRoot = ""): string {
  const { file, parsed } = readScopedManifest(workspaceRoot);
  if (parsed === null) {
    const asserted = String(assertedRoot || "").trim();
    if (asserted) return validateArtifactToolsRoot(asserted, "active artifact tool authority");
    throw new Error(
      `artifact build requires canonical generated tool authority at ${file}; run u && i`,
    );
  }
  const root = literalArtifactToolsRoot(
    String(parsed.artifactTools?.root || ""),
    `canonical artifact tool authority at ${file}`,
  );
  const asserted = String(assertedRoot || "").trim();
  if (asserted && literalArtifactToolsRoot(asserted, "active artifact tool authority") !== root) {
    throw new Error(
      `canonical artifact tool authority mismatch: generated=${root} active=${asserted}; run u && i`,
    );
  }
  return validateArtifactToolsRoot(root, "canonical artifact tool authority");
}

export async function installCanonicalArtifactToolsAuthority(
  workspaceRoot: string,
  assertedRoot: string,
): Promise<string> {
  const root = validateArtifactToolsRoot(assertedRoot, "declared artifact tool authority");
  const file = path.join(
    path.resolve(workspaceRoot),
    ".viberoots",
    "workspace",
    "toolchain-paths.json",
  );
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8")) as {
      artifactTools?: { root?: unknown };
    };
    if (String(parsed.artifactTools?.root || "") === root) return root;
  } catch {}
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await writeIfChanged(file, JSON.stringify({ artifactTools: { root } }, null, 2) + "\n");
  return root;
}
