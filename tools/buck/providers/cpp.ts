#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type Node = { name: string; labels?: string[] };

function normalizeAttr(attr: string): string {
  const s = String(attr || "").trim();
  if (!s) return s;
  let a = s.toLowerCase();
  if (!a.startsWith("pkgs.")) a = `pkgs.${a}`;
  if (a === "pkgs.gtest") a = "pkgs.googletest";
  return a;
}

function nameForAttr(attr: string): string {
  // pkgs.openssl -> pkgs_openssl, pkgs.gnome.glib -> pkgs_gnome_glib
  return `nix_pkgs_${attr.replace(/[^a-z0-9]+/g, "_")}`;
}

function encodeForPatchPrefix(attr: string): string {
  // pkgs.openssl -> pkgs/openssl -> pkgs__openssl
  return attr.replace(/\./g, "/").replace(/\//g, "__");
}

async function listCppPatchesFor(attr: string): Promise<string[]> {
  const dir = "patches/cpp";
  const out: string[] = [];
  if (!(await fs.pathExists(dir))) return out;
  const enc = encodeForPatchPrefix(attr);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith(".patch")) continue;
    if (!f.startsWith(`${enc}@`)) continue;
    out.push(path.join(dir, f));
  }
  out.sort();
  return out;
}

export async function syncCppProviders(opts?: { outFile?: string }) {
  const OUT = opts?.outFile || "third_party/providers/TARGETS.cpp.auto";
  const graphPath = "tools/buck/graph.json";
  const overlay = "tools/nix/overlays/cpp-patches.nix";
  const lockfile = "flake.lock";

  const providerLines: string[] = [];
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_cpp.bzl", "nix_cxx_provider")',
    "",
  ].join("\n");

  let nodes: Node[] = [];
  if (await fs.pathExists(graphPath)) {
    try {
      const txt = await fs.readFile(graphPath, "utf8");
      const data = JSON.parse(txt) as Node[] | Record<string, any>;
      nodes = Array.isArray(data) ? (data as Node[]) : (Object.values(data) as Node[]);
    } catch {}
  }

  const attrs = new Set<string>();
  for (const n of nodes) {
    for (const l of n.labels || []) {
      if (typeof l === "string" && l.startsWith("nixpkg:")) {
        const a = normalizeAttr(l.slice("nixpkg:".length));
        if (a) attrs.add(a);
      }
    }
  }
  const attrList = Array.from(attrs).sort();

  const overlayPaths = (await fs.pathExists(overlay)) ? [overlay] : [];
  const hasLock = await fs.pathExists(lockfile).catch(() => false);

  for (const attr of attrList) {
    const name = nameForAttr(attr);
    const patch_paths = await listCppPatchesFor(attr);
    const lines: string[] = [];
    lines.push("nix_cxx_provider(");
    lines.push(`    name = \"${name}\",`);
    lines.push(`    attr = \"${attr}\",`);
    if (overlayPaths.length) {
      lines.push(
        `    overlay_paths = [${overlayPaths.map((p) => `\"${p}\"`).join(", \n        ")}],`,
      );
    } else {
      lines.push("    overlay_paths = [],");
    }
    if (patch_paths.length) {
      lines.push(
        `    patch_paths = [\n${patch_paths.map((p) => `        \"${p}\",`).join("\n")}\n    ],`,
      );
    } else {
      lines.push("    patch_paths = [],");
    }
    if (hasLock) {
      lines.push(`    lockfile = \"${lockfile}\",`);
    } else {
      lines.push('    lockfile = "",');
    }
    lines.push(")\n");
    providerLines.push(lines.join("\n"));
  }

  const data = header + providerLines.join("\n");
  await fs.outputFile(OUT, data, "utf8");
}
