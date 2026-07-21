import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { probeRealizedFinalPnpmStore } from "../../dev/update-pnpm-hash/realized-store";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";

export type FakeMode =
  | "eval-failure"
  | "missing"
  | "invalid"
  | "validity-command-failure"
  | "validity-malformed"
  | "validation-failure"
  | "success";

let immutableAuthorityPromise: Promise<string> | undefined;

async function immutableAuthority(): Promise<string> {
  immutableAuthorityPromise ||= (async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-final-probe-authority-"));
    try {
      await fsp.mkdir(path.join(tmp, "build-tools/tools/dev"), { recursive: true });
      await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n");
      await fsp.writeFile(path.join(tmp, "build-tools/tools/dev/zx-init.mjs"), "\n");
      const env = buildCanonicalArtifactEnvironment(process.cwd(), {
        artifactToolsRoot: canonicalArtifactToolsRoot(
          process.cwd(),
          String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
        ),
      });
      return (await materializeFilteredViberootsSource(tmp, env)).storePath;
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  })();
  return await immutableAuthorityPromise;
}

export function existingStorePath(): string {
  const match = path.resolve(process.execPath).match(/^(\/nix\/store\/[^/]+)/);
  if (!match?.[1]) throw new Error(`test node is not in /nix/store: ${process.execPath}`);
  return match[1];
}

export async function withFakeNix<T>(
  mode: FakeMode,
  evaluatedPath: string,
  fn: (log: string) => Promise<T>,
) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-final-probe-"));
  const log = path.join(tmp, "nix.log");
  const nix = path.join(tmp, "nix");
  const nixStore = path.join(tmp, "nix-store");
  const authority = await immutableAuthority();
  await fsp.writeFile(
    nix,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf 'cwd=%s args=%s exact=%s index=%s lock=%s generate=%s materialize=%s\\n' "$PWD" "$*" "\${NIX_PNPM_EXACT_STORE:-}" "\${NIX_PNPM_EXACT_STORE_INDEX:-}" "\${NIX_PNPM_EXACT_STORE_LOCK_HASH:-}" "\${NIX_PNPM_ALLOW_GENERATE:-}" "\${NIX_PNPM_MATERIALIZE:-}" >> ${JSON.stringify(log)}`,
      `if [[ "$1" == "eval" ]]; then`,
      mode === "eval-failure"
        ? '  echo "authoritative eval failure" >&2; exit 41'
        : `  printf '%s' ${JSON.stringify(evaluatedPath)}; exit 0`,
      "fi",
      mode === "validation-failure"
        ? 'echo "literal path validation failure" >&2; exit 42'
        : 'printf "%s\\n" "$2"',
    ].join("\n"),
    { mode: 0o755 },
  );
  await fsp.writeFile(
    nixStore,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf 'store-args=%s\\n' "$*" >> ${JSON.stringify(log)}`,
      mode === "validity-command-failure"
        ? 'echo "literal validity command failure" >&2; exit 43'
        : mode === "validity-malformed"
          ? 'printf "%s\\n" "/nix/store/unexpected-invalid-path"'
          : mode === "invalid"
            ? 'printf "%s\\n" "$3"'
            : ":",
    ].join("\n"),
    { mode: 0o755 },
  );
  const previous = {
    nix: process.env.VBR_NIX_BIN,
    nixStore: process.env.VBR_NIX_STORE_BIN,
    exact: process.env.NIX_PNPM_EXACT_STORE,
    index: process.env.NIX_PNPM_EXACT_STORE_INDEX,
    lock: process.env.NIX_PNPM_EXACT_STORE_LOCK_HASH,
    generate: process.env.NIX_PNPM_ALLOW_GENERATE,
    materialize: process.env.NIX_PNPM_MATERIALIZE,
    authority: process.env.VIBEROOTS_FLAKE_INPUT_ROOT,
  };
  try {
    process.env.VBR_NIX_BIN = nix;
    process.env.VBR_NIX_STORE_BIN = nixStore;
    process.env.NIX_PNPM_EXACT_STORE = "forbidden-exact";
    process.env.NIX_PNPM_EXACT_STORE_INDEX = "forbidden-index";
    process.env.NIX_PNPM_EXACT_STORE_LOCK_HASH = "forbidden-lock";
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    process.env.NIX_PNPM_MATERIALIZE = "1";
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT = authority;
    return await fn(log);
  } finally {
    for (const [key, value] of Object.entries({
      VBR_NIX_BIN: previous.nix,
      VBR_NIX_STORE_BIN: previous.nixStore,
      NIX_PNPM_EXACT_STORE: previous.exact,
      NIX_PNPM_EXACT_STORE_INDEX: previous.index,
      NIX_PNPM_EXACT_STORE_LOCK_HASH: previous.lock,
      NIX_PNPM_ALLOW_GENERATE: previous.generate,
      NIX_PNPM_MATERIALIZE: previous.materialize,
      VIBEROOTS_FLAKE_INPUT_ROOT: previous.authority,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export function probe(expectedPath: string) {
  return probeRealizedFinalPnpmStore({
    repoRoot: process.cwd(),
    importer: "projects/apps/demo",
    flakeRef: "path:/tmp/filtered#pnpm",
    attrPath: "pnpm-store.projects-apps-demo",
    expectedPath,
  });
}
