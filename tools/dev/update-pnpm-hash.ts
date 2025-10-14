#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

async function buildStore(): Promise<{ ok: boolean; output: string }> {
  try {
    const res = await $({ stdio: "pipe" })`nix build .#pnpm-store --no-link --accept-flake-config`;
    return { ok: true, output: String(res.stdout || "") + String(res.stderr || "") };
  } catch (e: any) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    return { ok: false, output: out };
  }
}

function extractHash(text: string): string | null {
  const all = Array.from(text.matchAll(/sha256-[A-Za-z0-9+/=\-_]{43,}/g)).map((m) => m[0]);
  if (all.length) return all[all.length - 1];
  return null;
}

async function rewritePnpmStoreHash(newHash: string) {
  // Update the fixed-output hash in tools/nix/node-modules.nix (pnpm-store derivation)
  const nmPath = path.join(process.cwd(), "tools", "nix", "node-modules.nix");
  const src = await fsp.readFile(nmPath, "utf8");
  const next = src.replace(/(outputHash\s*=\s*")sha256-[^"]+(";)/, `$1${newHash}$2`);
  if (next === src) {
    throw new Error("could not locate outputHash line to update in tools/nix/node-modules.nix");
  }
  await fsp.writeFile(nmPath, next, "utf8");
}

async function main() {
  const first = await buildStore();
  if (first.ok) {
    console.log("pnpm-store: up to date");
    return;
  }
  const suggested = extractHash(first.output || "");
  if (!suggested) {
    console.error("failed to parse suggested sha256 from nix output\n\n" + first.output);
    process.exit(1);
  }
  await rewritePnpmStoreHash(suggested);
  const second = await buildStore();
  if (!second.ok) {
    console.error("pnpm-store still failing after hash update\n\n" + second.output);
    process.exit(1);
  }
  console.log("pnpm-store: hash updated and build succeeded");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
