import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "../../dev/nix-build-filtered-flake-lib";
import { extractHash } from "../../dev/update-pnpm-hash/nix";
import { removeOwnedTempTree } from "../../lib/owned-temp-cleanup";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { directorySizeKib } from "./pnpm-fixed-store-native-run";
import { PLACEHOLDER } from "./pnpm-fixed-store-native-fixture";

const FILTERED_SOURCE_MAX_KIB = 64 * 1024;
const execFileAsync = promisify(execFile);

export async function immutableProductionSource(liveRoot: string): Promise<string> {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-native-pnpm-source-"));
  const filtered = path.join(fixture, "source");
  try {
    const relPaths: string[] = [];
    for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
      if (
        await fsp.access(path.join(liveRoot, rel)).then(
          () => true,
          () => false,
        )
      ) {
        relPaths.push(rel);
      }
    }
    await fsp.mkdir(filtered);
    assert.notEqual(
      path.resolve(filtered),
      path.resolve(liveRoot),
      "native reconciliation must never hand the raw live repo root to Nix",
    );
    await execFileAsync(
      resolveToolPathSync("rsync"),
      [
        "-a",
        "--delete",
        "--relative",
        ...filteredFlakeRsyncExcludeArgs(),
        ...defaultFilteredFlakeSnapshotRsyncSources(relPaths),
        `${filtered}/`,
      ],
      { cwd: liveRoot, timeout: 30_000 },
    );
    assert.ok(
      (await directorySizeKib(filtered)) <= FILTERED_SOURCE_MAX_KIB,
      "native reconciliation filtered source must stay below 64 MiB",
    );
    const env = buildCanonicalArtifactEnvironment(process.cwd(), {
      artifactToolsRoot: canonicalArtifactToolsRoot(
        process.cwd(),
        String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
      ),
    });
    const inputRoot = (await materializeFilteredViberootsSource(filtered, env)).storePath;
    assert.match(inputRoot, /^\/nix\/store\/[a-z0-9]{32}-source$/);
    assert.ok(
      (await directorySizeKib(inputRoot)) <= FILTERED_SOURCE_MAX_KIB,
      "native reconciliation immutable source must stay below 64 MiB",
    );
    return inputRoot;
  } finally {
    await removeOwnedTempTree(fixture);
  }
}

export function mismatchCandidate(stderr: string): string {
  const matches = Array.from(
    stderr.matchAll(
      /viberoots-pnpm-fod-hash-mismatch-v1 output=(\/nix\/store\/[a-z0-9]{32}-pnpm-store-lock-[a-f0-9]{64}) specified=sha256-[A-Za-z0-9+/]{43}= got=sha256-[A-Za-z0-9+/]{43}=/g,
    ),
  ).map((match) => match[1]);
  const unique = [...new Set(matches)];
  assert.equal(unique.length, 1, `expected one unique authoritative mismatch path:\n${stderr}`);
  return unique[0];
}

export function strictGot(stderr: string): string {
  const candidate = mismatchCandidate(stderr);
  const derivationName = path.basename(candidate).replace(/^[a-z0-9]{32}-/, "");
  const got = extractHash(stderr, derivationName, PLACEHOLDER);
  assert.match(String(got || ""), /^sha256-[A-Za-z0-9+/]{43}=$/);
  return got as string;
}
