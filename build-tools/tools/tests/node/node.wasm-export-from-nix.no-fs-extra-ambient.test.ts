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

test("export-wasm-from-nix works without ambient fs-extra", async () => {
  await runInTemp("node-wasm-export-no-fs-extra", async (tmp) => {
    const fakeOut = path.join(tmp, "fake-nix-out");
    await fsp.mkdir(path.join(fakeOut, "lib"), { recursive: true });
    const expected = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    await fsp.writeFile(path.join(fakeOut, "lib", "top.wasm"), expected);

    await fsp.mkdir(path.join(tmp, "build-tools", "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "graph.json"),
      "{}\n",
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
echo "${fakeOut}"
`,
    );

    const outPath = path.join(tmp, "buck-out", "tmp", "top.wasm");
    await runNodeWithZx({
      script: path.join(tmp, "build-tools", "tools", "wasm", "export-wasm-from-nix.ts"),
      cwd: tmp,
      zxInitPath: path.join(tmp, "build-tools", "tools", "dev", "zx-init.mjs"),
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
        WASM_TARGET: "//projects/libs/demo-wasm:wasm",
        WASM_DIR: "lib",
        OUT_PATH: outPath,
      },
    });

    const actual = await fsp.readFile(outPath);
    assert.deepEqual(actual, expected);
  });
});
