import fs from "fs-extra";
import path from "node:path";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export async function writePackagingTsFixture(tmp: string): Promise<string> {
  await fs.outputFile(
    path.join(tmp, "viberoots", "build-tools", "cpp", "defs.bzl"),
    await fs.readFile(viberootsSourcePath("viberoots/build-tools/cpp/defs.bzl"), "utf8"),
  );
  await fs.outputFile(
    path.join(tmp, "viberoots", "build-tools", "cpp", "wasm_defs.bzl"),
    await fs.readFile(viberootsSourcePath("viberoots/build-tools/cpp/wasm_defs.bzl"), "utf8"),
  );

  const tsPkg = path.join(tmp, "projects", "libs", "math-ts");
  await fs.mkdirp(path.join(tsPkg, "src", "browser"));
  await fs.mkdirp(path.join(tsPkg, "src", "node"));
  await fs.mkdirp(path.join(tsPkg, "src", "types"));
  await fs.writeFile(
    path.join(tsPkg, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
  );
  await fs.writeJson(path.join(tsPkg, "package.json"), {
    name: "@org/math",
    type: "module",
    exports: {
      ".": {
        browser: "./dist/browser/index.js",
        node: "./dist/node/index.cjs",
        default: "./dist/browser/index.js",
      },
    },
    types: "./dist/types/index.d.ts",
  });
  await fs.writeFile(
    path.join(tsPkg, "src", "browser", "index.js"),
    `
const url = new URL("./top.wasm", import.meta.url);
let inst;
try {
  if (url.protocol === "file:") {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(url);
    try {
      ({ instance: inst } = await WebAssembly.instantiate(bytes, {}));
    } catch {
      const { WASI } = await import('node:wasi');
      const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
      ({ instance: inst } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi.wasiImport }));
      if (typeof wasi.start === 'function') wasi.start(inst);
    }
  } else {
    try {
      const res = await fetch(url);
      ({ instance: inst } = await WebAssembly.instantiateStreaming(res, {}));
    } catch {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      ({ instance: inst } = await WebAssembly.instantiate(buf, {}));
    }
  }
} catch {}
const exp = inst && inst.exports ? inst.exports : {};
export function add(a, b) {
  return exp.add ? exp.add(a, b) : 0;
}
`,
  );
  await fs.writeFile(
    path.join(tsPkg, "src", "node", "index.cjs"),
    `
const path = require("node:path");
const addon = require(path.join(__dirname, "../native/math_native.node"));
exports.add = (a, b) => addon.add(a, b);
`,
  );
  await fs.writeFile(
    path.join(tsPkg, "src", "types", "index.d.ts"),
    "export declare function add(a: number, b: number): number;\n",
  );
  await fs.writeFile(
    path.join(tsPkg, "TARGETS"),
    `load("@prelude//:rules.bzl", "genrule")

genrule(
    name = "dist",
    srcs = [
        "src/browser/index.js",
        "src/node/index.cjs",
        "src/types/index.d.ts",
        "//projects/libs/math-api:wasm",
        "//projects/libs/math-native:napi_addon",
    ],
    out = "dist",
    cmd = "set -euo pipefail; " +
          "mkdir -p \\"$OUT\\"/browser \\"$OUT\\"/node \\"$OUT\\"/native \\"$OUT\\"/types; " +
          "cp src/browser/index.js \\"$OUT\\"/browser/index.js; " +
          "cp src/node/index.cjs \\"$OUT\\"/node/index.cjs; " +
          "cp src/types/index.d.ts \\"$OUT\\"/types/index.d.ts; " +
          "cp $(location //projects/libs/math-api:wasm) \\"$OUT\\"/browser/top.wasm; " +
          "cp $(location //projects/libs/math-native:napi_addon) \\"$OUT\\"/native/math_native.node",
    labels = [
        "lang:node",
        "kind:packaging",
        "lockfile:projects/libs/math-ts/pnpm-lock.yaml#projects/libs/math-ts",
    ],
    visibility = ["PUBLIC"],
)
`,
  );
  return tsPkg;
}
