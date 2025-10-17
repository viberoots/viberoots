#!/usr/bin/env zx-wrapper
import fs from "fs-extra";

function getArg(name: string, def = ""): string {
  const a: any = (global as any).argv || {};
  if (a && typeof a[name] === "string" && a[name]) return a[name] as string;
  const raw = process.argv;
  const idx = raw.indexOf(`--${name}`);
  if (idx >= 0 && raw[idx + 1]) return raw[idx + 1];
  return def;
}

const importer = getArg("importer");
const name = getArg("name");
const out = getArg("out");

if (!importer || !name || !out) {
  console.error("usage: node-cli-bundle --importer <apps/demo> --name <demo> --out <OUT>");
  process.exit(2);
}

function sanitize(s: string): string {
  return s.replaceAll("//", "").replaceAll(":", "-").replaceAll("/", "-").replaceAll(" ", "-");
}

const attr = `node-cli.${sanitize(importer)}`;

const { stdout } = await $`nix build .#${attr} --no-link --accept-flake-config --print-out-paths`;
const path = String(stdout || "")
  .trim()
  .split("\n")
  .filter(Boolean)
  .pop();
if (!path) {
  console.error("node-cli-bundle: nix build produced no output path");
  process.exit(3);
}
const src = `${path}/${name}.bundle.js`;
if (!(await fs.pathExists(src))) {
  console.error(`node-cli-bundle: expected bundle not found: ${src}`);
  process.exit(4);
}
await fs.copy(src, out);
await fs.chmod(out, 0o755);
console.log("wrote", out);
