#!/usr/bin/env zx-wrapper
/**
 * providers-headers.ts
 * Canonical generator for TARGETS file headers used by provider writers.
 * Produces a stable banner and load(...) lines with deterministic newlines.
 */

export type ProvidersHeaderOptions = {
  lang: string;
  load: string | string[]; // one or more Starlark load(...) lines
  rule?: string; // informative; not used in formatting but kept for parity
};

/**
 * Return a stable TARGETS header consisting of:
 * - A generated-file banner
 * - One or more load(...) lines
 * - Two trailing blank lines to separate the header from the body
 */
export function providersHeaderFor(opts: ProvidersHeaderOptions): string {
  const loads = Array.isArray(opts.load) ? opts.load.join("\n") : opts.load;
  // Keep exactly two trailing blank lines to preserve formatting stability
  return ["# GENERATED FILE — DO NOT EDIT.", loads, "", ""].join("\n");
}

/**
 * Canonical load(...) line for a language-specific providers defs file.
 * Example: load("@root//third_party/providers:defs_node.bzl", "node_importer_deps")
 */
export function providersLoadFor(args: { lang: string; rule: string }): string {
  const lang = String(args.lang || "").trim();
  const rule = String(args.rule || "").trim();
  return `load("@root//third_party/providers:defs_${lang}.bzl", "${rule}")`;
}

export default providersHeaderFor;
