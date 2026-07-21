import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ARTIFACT_NETWORK_SOURCE_POLICY } from "../../lib/artifact-network-policy";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

type Use = { file: string; primitive: string; block: string };

const NIX_SANDBOX_ESCAPE_ATTRIBUTES = [
  "__darwinAllowLocalNetworking",
  "__impureHostDeps",
  "__noChroot",
  "impureEnvVars",
  "sandboxProfile",
] as const;

function artifactExpressionFiles(): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (
        entry.isFile() &&
        (entry.name.endsWith(".nix") ||
          (entry.name.endsWith(".ts") && !absolute.includes(`${path.sep}tests${path.sep}`)))
      )
        files.push(absolute);
    }
  };
  visit(viberootsSourcePath("build-tools/tools"));
  return files;
}

function usesInSource(file: string, source: string): Use[] {
  const rel = path.relative(viberootsSourcePath("."), file);
  const uses: Use[] = [];
  const fetcher = file.endsWith(".nix")
    ? /\b(?:(?:builtins|pkgs)\.)?(fetch(?!(?:ed|es|ing)\b)[A-Za-z0-9_]+|getFlake)\b/g
    : /\bbuiltins\.(fetch(?!(?:ed|es|ing)\b)[A-Za-z0-9_]+|getFlake)\b/g;
  for (const match of source.matchAll(fetcher)) {
    const start = match.index ?? 0;
    const end = source.indexOf("};", start);
    uses.push({
      file: rel,
      primitive: match[1],
      block: source.slice(start, end < 0 ? Math.min(source.length, start + 800) : end + 2),
    });
  }
  if (file.endsWith(".nix")) {
    for (const match of source.matchAll(/\bpnpm\s+fetch\b/g)) {
      uses.push({ file: rel, primitive: "pnpm fetch", block: source });
    }
    for (const match of source.matchAll(/\b(curl|wget)\s+-/g)) {
      uses.push({ file: rel, primitive: match[1], block: source });
    }
  }
  return uses;
}

function usesIn(file: string): Use[] {
  return usesInSource(file, fs.readFileSync(file, "utf8"));
}

function productionNixFiles(): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".viberoots", "buck-out", "node_modules", "tests"].includes(entry.name)) {
        continue;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".nix")) files.push(absolute);
    }
  };
  visit(viberootsSourcePath("."));
  return files;
}

function nixSandboxEscapesInSource(source: string): string[] {
  return NIX_SANDBOX_ESCAPE_ATTRIBUTES.filter((attribute) =>
    new RegExp(`\\b${attribute}\\b`, "u").test(source),
  );
}

export function assertArtifactNetworkPolicyInventory(): void {
  assert.deepEqual(
    nixSandboxEscapesInSource(
      '__noChroot = true; __impureHostDeps = [ /host ]; impureEnvVars = [ "TOKEN" ]; __darwinAllowLocalNetworking = true; sandboxProfile = "allow all";',
    ),
    [...NIX_SANDBOX_ESCAPE_ATTRIBUTES],
    "sandbox escape inventory must recognize every prohibited derivation attribute",
  );
  assert.deepEqual(
    usesInSource(
      "hostile.nix",
      "fetchzip {}; fetchgit {}; fetchhg {}; fetchsvn {}; fetchClosure {}; builtins.fetchurl {}; getFlake {};",
    ).map(({ primitive }) => primitive),
    ["fetchzip", "fetchgit", "fetchhg", "fetchsvn", "fetchClosure", "fetchurl", "getFlake"],
    "network inventory must recognize every Nix fetch primitive family",
  );
  assert.deepEqual(
    usesInSource("generated.ts", 'const expr = "builtins.fetchurl { url = source; }";').map(
      ({ primitive }) => primitive,
    ),
    ["fetchurl"],
    "network inventory must recognize generated builtins fetch expressions",
  );
  const uses = artifactExpressionFiles().flatMap(usesIn);
  const sandboxEscapes = productionNixFiles().flatMap((file) =>
    nixSandboxEscapesInSource(fs.readFileSync(file, "utf8")).map(
      (attribute) => `${path.relative(viberootsSourcePath("."), file)}: ${attribute}`,
    ),
  );
  assert.deepEqual(sandboxEscapes, [], "production Nix must not use sandbox escape attributes");
  const policyKeys = new Set(
    ARTIFACT_NETWORK_SOURCE_POLICY.map(({ file, primitive }) => `${file}\0${primitive}`),
  );
  const observedKeys = new Set(uses.map(({ file, primitive }) => `${file}\0${primitive}`));
  assert.deepEqual(
    [...observedKeys].filter((key) => !policyKeys.has(key)).sort(),
    [],
    "unclassified Nix network primitive",
  );
  assert.deepEqual(
    [...policyKeys].filter((key) => !observedKeys.has(key)).sort(),
    [],
    "stale Nix network policy entry",
  );
  for (const use of uses) {
    const policy = ARTIFACT_NETWORK_SOURCE_POLICY.find(
      ({ file, primitive }) => file === use.file && primitive === use.primitive,
    );
    assert.ok(policy, `${use.file}: ${use.primitive} must be classified`);
    if (
      policy.ownership === "fixed-output" &&
      (use.primitive.startsWith("fetch") || use.primitive === "getFlake")
    ) {
      if (use.primitive === "fetchTree" || use.primitive === "getFlake") {
        assert.match(use.block, /\.locked/, `${use.file}: fetchTree must consume a locked input`);
      } else {
        assert.match(
          use.block,
          /(?:hash|outputHash|narHash|sha256)\s*=/,
          `${use.file}: ${use.primitive} must declare a hash`,
        );
      }
    }
    if (use.primitive === "pnpm fetch") {
      assert.match(use.block, /outputHash\s*=/, `${use.file}: pnpm fetch must remain fixed-output`);
    }
  }
}
