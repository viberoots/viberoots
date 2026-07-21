#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel, packagePathFromLabel } from "../../../lib/labels";
import { normalizeNixpkgPins, normalizeNixpkgsProfile } from "../../source-selection";
import type { Node } from "../types";

function uniqSorted(xs: string[]): string[] {
  return Array.from(new Set((xs || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function dedupePreserve(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function isTmpTarget(label: string): boolean {
  // Match // .tmp / paths across cells (e.g., root//.tmp/foo:bar or //.tmp/foo:bar)
  return /\/\/\.tmp\//.test(String(label || ""));
}

function coerceStringArray(v: any): string[] | undefined {
  return Array.isArray(v) ? (v as any[]).filter((x) => typeof x === "string") : undefined;
}

export function canonicalWorkspaceGraphOutput(label: string, output: unknown): unknown {
  const unconfigured = String(label || "").split(" (")[0];
  if (
    (unconfigured === "workspace_buck//:graph.json" ||
      unconfigured === "@workspace_buck//:graph.json") &&
    typeof output === "string"
  ) {
    return "graph.json";
  }
  return output;
}

function resolveRelativeTarget(raw: string, ownerLabel: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (!s.startsWith(":")) return s;
  const pkg = packagePathFromLabel(ownerLabel);
  if (!pkg) return s;
  return `//${pkg}${s}`;
}

export function normalizeLocationMacrosForOwner(ownerLabel: string, command: string): string {
  const marker = "$(location ";
  let cursor = 0;
  let output = "";
  while (cursor < command.length) {
    const start = command.indexOf(marker, cursor);
    if (start < 0) return output + command.slice(cursor);

    let depth = 1;
    let end = start + marker.length;
    for (; end < command.length; end += 1) {
      const char = command[end];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0) break;
    }
    if (depth !== 0) return output + command.slice(cursor);

    const rawLabel = command.slice(start + marker.length, end).trim();
    const normalized = normalizeTargetLabel(resolveRelativeTarget(rawLabel, ownerLabel));
    output += `${command.slice(cursor, start)}${marker}${normalized})`;
    cursor = end + 1;
  }
  return output;
}

function normalizeTargetsForOwner(ownerLabel: string, raw: unknown): string[] | undefined {
  const xs = coerceStringArray(raw) || [];
  if (xs.length === 0) return undefined;
  const normalized = xs
    .map((d) => normalizeTargetLabel(resolveRelativeTarget(d, ownerLabel)))
    .filter(Boolean);
  return dedupePreserve(normalized);
}

function normalizeSourcesForOwner(ownerLabel: string, raw: unknown): string[] | undefined {
  const xs = coerceStringArray(raw) || [];
  if (xs.length === 0) return undefined;
  return xs.map((source) => {
    const trimmed = source.trim();
    const targetLike =
      trimmed.startsWith(":") ||
      ((trimmed.startsWith("//") || /^[a-zA-Z0-9_.-]+\/\//u.test(trimmed)) &&
        trimmed.includes(":"));
    return targetLike ? normalizeTargetLabel(resolveRelativeTarget(trimmed, ownerLabel)) : source;
  });
}

export function nodesFromCqueryJson(merged: Record<string, any>): Node[] {
  const nodes: Node[] = [];
  for (const [label, raw] of Object.entries(merged || {})) {
    const a = (raw || {}) as Record<string, any>;
    const ruleType: string | undefined =
      typeof a["rule_type"] === "string"
        ? (a["rule_type"] as string)
        : (a["buck.type"] as string | undefined);
    const deps =
      coerceStringArray(a["deps"]) ??
      coerceStringArray(a["buck.deps"]) ??
      coerceStringArray(a["deps"]);
    const labelsArr =
      coerceStringArray(a["labels"]) ??
      coerceStringArray(a["buck.labels"]) ??
      coerceStringArray(a["labels"]);
    const srcsArr =
      coerceStringArray(a["srcs"]) ??
      coerceStringArray(a["buck.srcs"]) ??
      coerceStringArray(a["srcs"]);
    const normalizedSrcs = normalizeSourcesForOwner(label, srcsArr);

    const moduleRaw = a["module"] ?? a["buck.module"];
    const module =
      typeof moduleRaw === "string" && String(moduleRaw).trim() !== ""
        ? String(moduleRaw).trim()
        : undefined;

    const clean = normalizeTargetLabel(label);
    if (!clean || isTmpTarget(clean)) continue;
    const cleanDeps = deps
      ? deps.map((d) => normalizeTargetLabel(resolveRelativeTarget(d, clean)))
      : undefined;

    const linkDeps = normalizeTargetsForOwner(clean, a["link_deps"] ?? a["buck.link_deps"]);
    const headerDeps = normalizeTargetsForOwner(clean, a["header_deps"] ?? a["buck.header_deps"]);
    const linkClosure =
      typeof a["link_closure"] === "string"
        ? (a["link_closure"] as string)
        : typeof a["buck.link_closure"] === "string"
          ? (a["buck.link_closure"] as string)
          : undefined;
    const overridesRaw = (a["link_closure_overrides"] ?? a["buck.link_closure_overrides"]) as any;
    const overridesNormalized: Record<string, string> | undefined = (() => {
      if (!overridesRaw || typeof overridesRaw !== "object") return undefined;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(overridesRaw)) {
        const nk = normalizeTargetLabel(resolveRelativeTarget(String(k || ""), clean));
        if (!nk) continue;
        out[nk] = String(v || "");
      }
      return out;
    })();
    const nixpkgsProfile = normalizeNixpkgsProfile(
      a["nixpkgs_profile"] ?? a["buck.nixpkgs_profile"],
    );
    const nixpkgPins = normalizeNixpkgPins(a["nixpkg_pins"] ?? a["buck.nixpkg_pins"]);

    const node: any = {
      ...(a as any),
      name: clean,
      out: canonicalWorkspaceGraphOutput(label, a["out"]),
      rule_type: ruleType || a["rule_type"] || "",
      deps: cleanDeps || deps || a["deps"],
      labels: uniqSorted(labelsArr || []),
      srcs: normalizedSrcs || srcsArr || a["srcs"],
      ...(typeof a["cmd"] === "string"
        ? { cmd: normalizeLocationMacrosForOwner(clean, a["cmd"]) }
        : {}),
      ...(module ? { module } : {}),
      ...(linkDeps ? { link_deps: linkDeps } : {}),
      ...(headerDeps ? { header_deps: headerDeps } : {}),
      ...(linkClosure ? { link_closure: linkClosure } : {}),
      ...(overridesNormalized ? { link_closure_overrides: overridesNormalized } : {}),
      nixpkgs_profile: nixpkgsProfile,
      nixpkg_pins: nixpkgPins,
    };
    if (!module && "module" in node) delete node.module;
    nodes.push(node as Node);
  }

  // De-duplicate by normalized target label (node.name), preferring richer nodes.
  const mergedByName = new Map<string, Node>();
  for (const n of nodes) {
    const key = String((n as any)?.name || "");
    if (!key) continue;
    const cur = mergedByName.get(key);
    if (!cur) {
      mergedByName.set(key, n);
      continue;
    }
    const curRule = String((cur as any).rule_type || "");
    const nextRule = String((n as any).rule_type || "");
    const preferNextRule =
      (curRule === "" || curRule === "forward") && nextRule !== "" && nextRule !== "forward";
    mergedByName.set(key, {
      ...(cur as any),
      ...(n as any),
      rule_type: preferNextRule ? nextRule : curRule,
      labels: uniqSorted([...(cur.labels || []), ...((n.labels as any) || [])]),
      deps: uniqSorted([...(cur.deps || []), ...((n.deps as any) || [])]),
      srcs: uniqSorted([...(cur.srcs || []), ...((n.srcs as any) || [])]),
      link_deps: dedupePreserve([
        ...((cur as any).link_deps || []),
        ...((n as any).link_deps || []),
      ]),
      header_deps: dedupePreserve([
        ...((cur as any).header_deps || []),
        ...((n as any).header_deps || []),
      ]),
      nixpkgs_profile: (n as any).nixpkgs_profile || (cur as any).nixpkgs_profile || "default",
      nixpkg_pins: {
        ...(((cur as any).nixpkg_pins || {}) as Record<string, Record<string, string>>),
        ...(((n as any).nixpkg_pins || {}) as Record<string, Record<string, string>>),
      },
    });
  }

  return Array.from(mergedByName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
