import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildToolPath } from "./dev-build/paths";

const GLOBAL_NIX_INPUT_PATHS = [
  ".viberoots/workspace/buck/graph.json",
  ".viberoots/workspace/flake.lock",
  ".viberoots/workspace/flake.nix",
  ".viberoots/workspace/nixpkgs-source-registry-extension.nix",
  ".viberoots/workspace/TARGETS",
  "projects/config/node-modules.hashes.json",
  "projects/config/TARGETS",
] as const;

export async function globalNixInputFingerprint(root: string): Promise<string> {
  const digest = createHash("sha256");
  const inputs = [
    ...GLOBAL_NIX_INPUT_PATHS.map((relative) => ({
      key: relative,
      file: path.join(root, relative),
    })),
    {
      key: "@viberoots//build-tools/tools/nix:nixpkgs_source_registry",
      file: buildToolPath(root, "tools/nix/nixpkgs-source-registry.nix"),
    },
  ];
  for (const input of inputs) {
    const content = await fsp.readFile(input.file).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    digest.update(input.key);
    digest.update("\0");
    if (content === null) {
      digest.update("missing");
    } else {
      digest.update(content);
    }
    digest.update("\0");
  }
  return digest.digest("hex");
}
