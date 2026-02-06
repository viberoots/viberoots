#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function moduleSource(base64) {
  const encoded = JSON.stringify(base64);
  return [
    `export const wasmBytesBase64 = ${encoded};`,
    "const decodeBase64 = (value) => {",
    '  if (typeof atob === "function") {',
    "    const bin = atob(value);",
    "    const out = new Uint8Array(bin.length);",
    "    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);",
    "    return out;",
    "  }",
    '  if (typeof Buffer !== "undefined") {',
    '    return Uint8Array.from(Buffer.from(value, "base64"));',
    "  }",
    '  throw new Error("wasm inline module: no base64 decoder available");',
    "};",
    "export const wasmBytes = () => decodeBase64(wasmBytesBase64);",
    "",
  ].join("\n");
}

async function main() {
  const src = readEnv("SRC");
  const out = readEnv("OUT_PATH") || readEnv("OUT");
  if (!src || !out) {
    throw new Error("missing SRC or OUT_PATH");
  }
  const bytes = await fs.readFile(src);
  const base64 = bytes.toString("base64");
  const data = moduleSource(base64);
  await fs.ensureDir(path.dirname(out));
  await fs.writeFile(out, data, "utf8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
