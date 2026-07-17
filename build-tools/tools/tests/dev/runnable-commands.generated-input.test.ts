#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { envWithStubbedNix } from "../lib/test-helpers";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";

test("p auto source uses filtered flake when root viberoots input is generated workspace state", async () => {
  const repoRoot = process.cwd();
  const fakeRoot = path.join(
    repoRoot,
    "buck-out",
    `runnable-selected-generated-viberoots-input-${process.pid}-${Date.now()}`,
  );
  await fsp.rm(fakeRoot, { recursive: true, force: true }).catch(() => {});
  try {
    const target = "//projects/apps/demo:demo";
    const graphDir = path.join(fakeRoot, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(path.join(fakeRoot, "projects", "apps", "demo", "src"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(fakeRoot, "viberoots"), { recursive: true });
    await fsp.writeFile(
      path.join(fakeRoot, "flake.nix"),
      [
        "{",
        '  inputs.viberoots.url = "path:./.viberoots/workspace/viberoots-flake-input";',
        "  outputs = { self, viberoots, ... }: {};",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeRoot, "viberoots", "flake.nix"),
      "{ outputs = { self, ... }: {}; }\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeRoot, "flake.lock"),
      JSON.stringify({ nodes: { viberoots: {} }, root: "root", version: 7 }, null, 2) + "\n",
      "utf8",
    );
    await ensureBuckConfigForTempRepo(fakeRoot, $);
    await $({ cwd: fakeRoot, stdio: "pipe" })`git init`;
    await fsp.writeFile(
      path.join(fakeRoot, "projects", "apps", "demo", "src", "index.ts"),
      "console.log('ok');\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeRoot, "projects", "apps", "demo", "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        "genrule(",
        '    name = "demo",',
        '    out = "demo",',
        '    cmd = "touch $OUT",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "nix_node_cli_bin",
            labels: ["lang:node", "kind:bin"],
            srcs: ["projects/apps/demo/src/index.ts"],
            deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const stubBin = path.join(fakeRoot, "stub-bin");
    const fakeOut = path.join(fakeRoot, "fake-selected-out");
    const nixLog = path.join(fakeRoot, "nix-args.log");
    const realNixBin = resolveToolPathSync("nix", envWithResolvedNixBin(process.env));
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo "$*" >> ${JSON.stringify(nixLog)}`,
        'args="$*"',
        'if [[ "$args" == flake\\ prefetch\\ --json\\ --no-use-registries\\ --option\\ flake-registry\\ \\ path:* ]]; then',
        `  exec ${JSON.stringify(realNixBin)} "$@"`,
        "fi",
        'if [[ "$args" == store\\ add-path\\ --name\\ viberoots-evaluation-bundle\\ * ]]; then',
        `  exec ${JSON.stringify(realNixBin)} "$@"`,
        "fi",
        `out=${JSON.stringify(fakeOut)}`,
        'if [[ "$args" == *"#graph-generator-selected"* ]]; then',
        '  mkdir -p "$out/bin"',
        "  cat > \"$out/bin/demo\" <<'EOF'",
        "#!/usr/bin/env bash",
        "echo selected-prod-ok",
        "EOF",
        '  chmod +x "$out/bin/demo"',
        '  echo "$out"',
        "  exit 0",
        "fi",
        'echo "unexpected nix invocation: $args" >&2',
        "exit 92",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.chmod(path.join(stubBin, "nix"), 0o755);

    const tool = viberootsSourcePath("build-tools/tools/bin/p");
    const run = await $({
      cwd: fakeRoot,
      stdio: "pipe",
      env: {
        ...envWithStubbedNix(stubBin),
        WORKSPACE_ROOT: fakeRoot,
        BUCK_TEST_SRC: fakeRoot,
      },
    })`${tool} ${target}`;
    assert.match(String(run.stdout || ""), /selected-prod-ok/);
    assert.match(
      String(run.stderr || ""),
      /bundling relevant untracked files as local development source/,
      "the uncommitted fixture must be captured as an explicit local-development source",
    );

    const logTxt = await fsp.readFile(nixLog, "utf8");
    const escapedRoot = fakeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      logTxt,
      /flake prefetch --json --no-use-registries --option flake-registry  path:.*\/viberoots/,
      "generated workspace inputs must be materialized to immutable source identity",
    );
    assert.match(
      logTxt,
      /build .*path:.*#graph-generator-selected/,
      "the clean fixture must build through the immutable filtered flake",
    );
    assert.doesNotMatch(logTxt, new RegExp(`path:${escapedRoot}#`));
  } finally {
    await fsp.rm(fakeRoot, { recursive: true, force: true }).catch(() => {});
  }
});
