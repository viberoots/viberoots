#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";

export function isNixStorePath(p: string): boolean {
  return typeof p === "string" && (p === "/nix/store" || p.startsWith("/nix/store/"));
}

async function resolveCmdPath(cmd: string): Promise<string> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`command -v ${cmd}`;
    const raw =
      String(stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)[0] || "";
    if (!raw) return "";
    try {
      return await fsp.realpath(raw);
    } catch {
      return raw;
    }
  } catch {
    return "";
  }
}

async function resolveCmdPaths(cmd: string): Promise<string[]> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`which -a ${cmd}`;
    const raw = String(stdout || "")
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out: string[] = [];
    for (const p of raw) {
      try {
        out.push(await fsp.realpath(p));
      } catch {
        out.push(p);
      }
    }
    return Array.from(new Set(out));
  } catch {
    const one = await resolveCmdPath(cmd);
    return one ? [one] : [];
  }
}

export async function resolvePreferredCmdPath(cmd: string): Promise<string> {
  const paths = await resolveCmdPaths(cmd);
  const store = paths.find(isNixStorePath);
  return store || paths[0] || "";
}
