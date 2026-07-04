#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runNodeWithZx } from "../../lib/node-run";
import { runInTemp } from "../lib/test-helpers";

async function writeExecutable(file: string, data: string) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, data, { mode: 0o755 });
}

async function resolveRepoFile(rel: string): Promise<string> {
  for (const candidate of [rel, path.join("viberoots", rel)]) {
    try {
      await fsp.access(candidate);
      return path.resolve(candidate);
    } catch {}
  }
  return path.resolve(rel);
}

async function resolveViberootsRoot(): Promise<string> {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "../../../..");
}

test("export-wasm-from-nix resolves consumer root when launched under viberoots", async () => {
  await runInTemp("node-wasm-export-consumer-root", async (tmp) => {
    const zxInit = await resolveRepoFile("viberoots/build-tools/tools/dev/zx-init.mjs");
    const viberootsRoot = await resolveViberootsRoot();
    const scriptSource = await resolveRepoFile("build-tools/tools/wasm/export-wasm-from-nix.ts");
    const script = path.join(
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "wasm",
      "export-wasm-from-nix.ts",
    );
    await fsp.mkdir(path.dirname(script), { recursive: true });
    await fsp.copyFile(scriptSource, script);

    const fakeOut = path.join(tmp, "fake-nix-out");
    await fsp.mkdir(path.join(fakeOut, "site", "pyext"), { recursive: true });
    const expected = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    await fsp.writeFile(path.join(fakeOut, "site", "pyext", "_native.wasm"), expected);

    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace", "buck"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "viberoots", "flake.nix"), "{}\n", "utf8");
    await fsp.mkdir(path.join(tmp, "projects", "libs", "demo-py-wasm"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "projects", "libs", "demo-py-wasm", "uv.lock"), "\n");
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "flake.nix"),
      '{ inputs.viberoots.url = "path:../../viberoots"; outputs = _: {}; }\n',
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "graph.json"),
      JSON.stringify({
        nodes: [
          {
            name: "root//projects/libs/demo-py-wasm:pyext (config//platforms:default)",
            labels: ["lang:python", "kind:pyext_wasm", "backend:pyodide"],
          },
        ],
      }) + "\n",
      "utf8",
    );

    const fakeBin = path.join(tmp, "fake-bin");
    await writeExecutable(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"flake prefetch"* ]]; then
  exit 1
fi
if [[ "$*" == hash\\ path\\ --sri* ]]; then
  echo "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  exit 0
fi
if [ "\${BUCK_TEST_SRC:-}" != "${tmp}" ]; then
  echo "expected consumer root, got BUCK_TEST_SRC=\${BUCK_TEST_SRC:-}" >&2
  exit 43
fi
echo "${fakeOut}"
`,
    );

    const outPath = path.join(tmp, "buck-out", "tmp", "_native.wasm");
    const result = await runNodeWithZx({
      script,
      cwd: path.join(tmp, "viberoots"),
      zxInitPath: zxInit,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        NIX_BIN: path.join(fakeBin, "nix"),
        VIBEROOTS_ROOT: viberootsRoot,
        WASM_TARGET: "//projects/libs/demo-py-wasm:pyext",
        WASM_DIR: "site/pyext",
        WASM_NAME: "_native",
        OUT_PATH: outPath,
      },
    });
    assert.match(result.stderr, /creating selected python snapshot/);

    const actual = await fsp.readFile(outPath);
    assert.deepEqual(actual, expected);
  });
});
