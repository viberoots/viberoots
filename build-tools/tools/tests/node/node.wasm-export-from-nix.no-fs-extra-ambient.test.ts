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

test("export-wasm-from-nix works without ambient fs-extra", async () => {
  await runInTemp("node-wasm-export-no-fs-extra", async (tmp) => {
    const zxInit = await resolveRepoFile("viberoots/build-tools/tools/dev/zx-init.mjs");
    const viberootsRoot = await resolveViberootsRoot();
    const scriptSource = await resolveRepoFile("build-tools/tools/wasm/export-wasm-from-nix.ts");
    const script = path.join(tmp, "build-tools", "tools", "wasm", "export-wasm-from-nix.ts");
    await fsp.mkdir(path.dirname(script), { recursive: true });
    await fsp.copyFile(scriptSource, script);
    await fsp.rm(path.join(tmp, "viberoots"), { recursive: true, force: true });
    await fsp.rm(path.join(tmp, ".viberoots"), { recursive: true, force: true });

    const fakeOut = path.join(tmp, "fake-nix-out");
    await fsp.mkdir(path.join(fakeOut, "lib"), { recursive: true });
    const expected = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    await fsp.writeFile(path.join(fakeOut, "lib", "top.wasm"), expected);

    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace", "buck"), { recursive: true });
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
            name: "root//projects/libs/demo-wasm:wasm (config//platforms:default)",
            labels: ["lang:cpp", "kind:wasm"],
          },
        ],
      }) + "\n",
      "utf8",
    );

    const poisonedFsExtraDir = path.join(
      tmp,
      "build-tools",
      "tools",
      "wasm",
      "node_modules",
      "fs-extra",
    );
    await fsp.mkdir(poisonedFsExtraDir, { recursive: true });
    await fsp.writeFile(
      path.join(poisonedFsExtraDir, "package.json"),
      JSON.stringify({ name: "fs-extra", type: "module", exports: "./index.js" }, null, 2) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(poisonedFsExtraDir, "index.js"),
      "throw new Error('unexpected fs-extra import in export-wasm-from-nix.ts');\n",
      "utf8",
    );

    const fakeBin = path.join(tmp, "fake-bin");
    await writeExecutable(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"flake metadata"* ]]; then
  printf '{"url":"path:%s?lastModified=1&narHash=sha256-test"}\\n' "\${VIBEROOTS_ROOT:-$PWD}"
  exit 0
fi
if [[ "$*" == hash\\ path\\ --sri* ]]; then
  echo "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  exit 0
fi
echo "${fakeOut}"
`,
    );

    const nixBin = path.join(fakeBin, "nix");
    const outPath = path.join(tmp, "buck-out", "tmp", "top.wasm");
    await runNodeWithZx({
      script,
      cwd: tmp,
      zxInitPath: zxInit,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        VBR_NIX_BIN: nixBin,
        NIX_BIN: nixBin,
        VIBEROOTS_ROOT: viberootsRoot,
        WASM_TARGET: "//projects/libs/demo-wasm:wasm",
        WASM_DIR: "lib",
        OUT_PATH: outPath,
      },
    });

    const actual = await fsp.readFile(outPath);
    assert.deepEqual(actual, expected);
  });
});

test("export-wasm-from-nix does not force C++ planner mode for Python wasm targets", async () => {
  await runInTemp("node-wasm-export-python-planner-mode", async (tmp) => {
    const zxInit = await resolveRepoFile("viberoots/build-tools/tools/dev/zx-init.mjs");
    const viberootsRoot = await resolveViberootsRoot();
    const scriptSource = await resolveRepoFile("build-tools/tools/wasm/export-wasm-from-nix.ts");
    const script = path.join(tmp, "build-tools", "tools", "wasm", "export-wasm-from-nix.ts");
    await fsp.mkdir(path.dirname(script), { recursive: true });
    await fsp.copyFile(scriptSource, script);
    await fsp.rm(path.join(tmp, "viberoots"), { recursive: true, force: true });
    await fsp.rm(path.join(tmp, ".viberoots"), { recursive: true, force: true });

    const fakeOut = path.join(tmp, "fake-nix-out");
    await fsp.mkdir(path.join(fakeOut, "site", "pyext"), { recursive: true });
    const expected = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    await fsp.writeFile(path.join(fakeOut, "site", "pyext", "_native.wasm"), expected);

    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace", "buck"), { recursive: true });
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
if [[ "$*" == *"flake metadata"* ]]; then
  printf '{"url":"path:%s?lastModified=1&narHash=sha256-test"}\\n' "\${VIBEROOTS_ROOT:-$PWD}"
  exit 0
fi
if [[ "$*" == hash\\ path\\ --sri* ]]; then
  echo "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  exit 0
fi
if [ "\${BUCK_TARGET:-}" = "//projects/libs/demo-py-wasm:pyext" ] && [ -n "\${PLANNER_ONLY_CPP:-}" ]; then
  echo "PLANNER_ONLY_CPP must not be set for Python wasm export" >&2
  exit 42
fi
echo "${fakeOut}"
`,
    );

    const nixBin = path.join(fakeBin, "nix");
    const outPath = path.join(tmp, "buck-out", "tmp", "_native.wasm");
    try {
      await runNodeWithZx({
        script,
        cwd: tmp,
        zxInitPath: zxInit,
        stdio: "pipe",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          VBR_NIX_BIN: nixBin,
          NIX_BIN: nixBin,
          VIBEROOTS_ROOT: viberootsRoot,
          WASM_TARGET: "//projects/libs/demo-py-wasm:pyext",
          WASM_DIR: "site/pyext",
          WASM_NAME: "_native",
          OUT_PATH: outPath,
        },
      });
    } catch (err) {
      assert.fail(String((err as { stderr?: string }).stderr || err));
    }

    const actual = await fsp.readFile(outPath);
    assert.deepEqual(actual, expected);
  });
});
