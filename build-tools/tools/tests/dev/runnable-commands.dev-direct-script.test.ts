#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("d selected webapp dev bypasses pnpm-backed generated dev scripts", async () => {
  await runInTemp("runnable-dev-direct-script", async (tmp, $) => {
    const target = "//projects/apps/demo:app";
    const importer = "projects/apps/demo";
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    const projectDir = path.join(tmp, importer);
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(path.join(projectDir, "scripts"), { recursive: true });
    await fsp.writeFile(
      path.join(projectDir, "scripts", "dev.mjs"),
      "console.error('stale dev script should not run'); process.exit(78);\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(projectDir, "scripts", "dev-wasm-watch.mjs"),
      "console.log('watch-ok');\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "node_webapp",
            labels: [
              "lang:node",
              "kind:app",
              "webapp:ssr",
              "framework:vite",
              `lockfile:${importer}/pnpm-lock.yaml#${importer}`,
            ],
            srcs: [`${importer}/src/entry-server.ts`],
            deps: [],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const stubBin = path.join(tmp, "stub-bin");
    const fakeOut = path.join(tmp, "fake-selected-out");
    const realZxWrapper = String((await $({ stdio: "pipe" })`command -v zx-wrapper`).stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)[0];
    assert.ok(realZxWrapper, "expected zx-wrapper on PATH");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      path.join(stubBin, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'args="$*"',
        `out=${JSON.stringify(fakeOut)}`,
        'if [[ "$args" == *"graph-generator-selected"* ]]; then',
        '  mkdir -p "$out/dist/server" "$out/dist/client"',
        '  echo "console.log(\'server\')" > "$out/dist/server/index.js"',
        '  echo "$out"',
        "  exit 0",
        "fi",
        'echo "unexpected nix invocation: $args" >&2',
        "exit 92",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(stubBin, "pnpm"),
      "#!/usr/bin/env bash\necho 'pnpm should not run' >&2\nexit 77\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(stubBin, "zx-wrapper"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [[ "$*" == *"run-runnable.ts"* ]]; then',
        '  exec "$REAL_ZX_WRAPPER" "$@"',
        "fi",
        "printf 'direct-dev-ok:%s\\n' \"$PWD\"",
        "printf 'args:%s\\n' \"$*\"",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    await $`chmod +x ${path.join(stubBin, "nix")} ${path.join(stubBin, "pnpm")} ${path.join(stubBin, "zx-wrapper")}`;

    const run = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH || ""}`,
        REAL_ZX_WRAPPER: realZxWrapper,
      },
    })`viberoots/build-tools/tools/bin/d ${target}`;

    assert.match(String(run.stdout || ""), /direct-dev-ok:/);
    assert.match(String(run.stdout || ""), /--vite-cmd node server\/dev\.mjs/);
    assert.match(String(run.stdout || ""), /--watch-cmd node scripts\/dev-wasm-watch\.mjs/);
    assert.match(
      String(run.stdout || ""),
      new RegExp(projectDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.doesNotMatch(String(run.stderr || ""), /pnpm should not run/);
    assert.doesNotMatch(String(run.stderr || ""), /stale dev script should not run/);
  });
});
