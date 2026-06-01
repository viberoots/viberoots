import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../lib/repo";

const OPENTOFU_SOURCE_DIR = "build-tools/deployments/aws-control-plane-foundation/opentofu";
export const OPENTOFU_BUNDLE_DIR = "opentofu/aws-control-plane-foundation";

export function renderOpenTofuStackFiles(): Record<string, string> {
  return Object.fromEntries(
    opentofuSourceFilenames().map((name) => [
      `${OPENTOFU_BUNDLE_DIR}/${name}`,
      readFileSync(path.join(repoRoot(), OPENTOFU_SOURCE_DIR, name), "utf8"),
    ]),
  );
}

export function opentofuStackInputs(): string[] {
  return opentofuSourceFilenames().map((name) => `$PROFILE_ROOT/${OPENTOFU_BUNDLE_DIR}/${name}`);
}

function opentofuSourceFilenames(): string[] {
  return readdirSync(path.join(repoRoot(), OPENTOFU_SOURCE_DIR))
    .filter((name) => name.endsWith(".tf") || name.endsWith(".hcl.example"))
    .sort();
}
