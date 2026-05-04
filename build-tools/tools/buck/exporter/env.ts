#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import os from "node:os";
import { requireGoToolchainBin } from "../../lib/toolchain-paths";
import type { Node, Tuple } from "./types";

export function parseTagsFromLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const l of labels || []) {
    if (l.startsWith("gotags:")) {
      const rest = l.slice("gotags:".length);
      for (const t of rest.split(",")) {
        const v = t.trim().toLowerCase();
        if (v) out.add(v);
      }
    }
  }
  return Array.from(out).sort();
}

export function parseTagsFromGOFLAGS(envGOFLAGS: string | undefined): string[] {
  const s = envGOFLAGS || "";
  if (!s) return [];
  const out = new Set<string>();
  for (const part of s.split(/\s+/)) {
    if (part.startsWith("-tags=")) {
      const val = part.slice("-tags=".length).replace(/^\"|\"$/g, "");
      for (const tok of val.split(/[ ,]+/)) {
        const v = tok.trim().toLowerCase();
        if (v) out.add(v);
      }
    }
  }
  return Array.from(out).sort();
}

export function normalizeGOFLAGS(s: string | undefined): string {
  const v = (s || "").trim();
  if (!v) return "";
  const parts = v.split(/\s+/);
  const norm: string[] = [];
  for (const p of parts) {
    if (p.startsWith("-tags=")) {
      const val = p.slice("-tags=".length).replace(/^\"|\"$/g, "");
      const tags = val
        .split(/[ ,]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .sort();
      norm.push(`-tags=${tags.join(",")}`);
    } else {
      norm.push(p);
    }
  }
  return norm.join(" ");
}

function parseGoEnvFromLabels(labels: string[] | undefined): {
  goos?: string;
  goarch?: string;
  cgo?: string;
} {
  const out: { goos?: string; goarch?: string; cgo?: string } = {};
  for (const l of labels || []) {
    if (l.startsWith("goenv:")) {
      const kv = l.slice("goenv:".length);
      const [k, v] = kv.split("=");
      if (k === "GOOS" && v) out.goos = v.toLowerCase();
      else if (k === "GOARCH" && v) out.goarch = v.toLowerCase();
      else if (k === "CGO_ENABLED" && v) out.cgo = v === "1" ? "1" : "0";
    }
  }
  return out;
}

async function gatherToolchainIdentity(): Promise<string> {
  try {
    const goBin = await requireGoToolchainBin();
    const { stdout: gorootOut } = await $({ stdio: "pipe" })`${goBin} env GOROOT`;
    const { stdout: goversionOut } = await $({ stdio: "pipe" })`${goBin} version`;
    const goroot = String(gorootOut || "").trim();
    const goversion = String(goversionOut || "").trim();
    const obj = {
      goroot,
      goversion,
      goos: process.env.GOOS || (os.platform() === "darwin" ? "darwin" : os.platform()),
      goarch:
        process.env.GOARCH ||
        (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch),
      cgo: process.env.CGO_ENABLED || "1",
    } as const;
    return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
  } catch {
    return "unknown";
  }
}

export async function deriveTupleForNode(n: Node): Promise<Tuple> {
  const envFromLabels = parseGoEnvFromLabels(n.labels);
  const goos = (
    envFromLabels.goos ||
    process.env.GOOS ||
    (os.platform() === "darwin" ? "darwin" : os.platform())
  ).toString();
  const goarch =
    envFromLabels.goarch ||
    process.env.GOARCH ||
    (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch);
  const cgo = envFromLabels.cgo || process.env.CGO_ENABLED || "1";
  const tagsFromLabels = parseTagsFromLabels(n.labels);
  const tagsFromFlags = parseTagsFromGOFLAGS(process.env.GOFLAGS);
  const mergedTags = Array.from(new Set([...tagsFromLabels, ...tagsFromFlags])).sort();
  const goflagsKey = normalizeGOFLAGS(process.env.GOFLAGS);
  const toolchain = await gatherToolchainIdentity();
  return { goos, goarch, cgo, tagsKey: mergedTags.join(","), goflagsKey, toolchain };
}

export function tupleKey(t: Tuple): string {
  return [t.goos, t.goarch, t.cgo, t.tagsKey, t.goflagsKey, t.toolchain].join("|");
}
