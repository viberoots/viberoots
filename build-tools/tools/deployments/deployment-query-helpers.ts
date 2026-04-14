#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../lib/labels.ts";

const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

export function deploymentBuckEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    HOME: env.BUCK2_REAL_HOME || env.HOME,
    SSL_CERT_FILE: env.SSL_CERT_FILE || env.NIX_SSL_CERT_FILE,
  };
}

export function deploymentIsolationArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.BUCK_NO_ISOLATION === "1") return [];
  const isolationDir = String(
    env.BUCK_ISOLATION_DIR || env.BUCK_ISOLATION_DIR_EXPORTER || env.BUCK_NESTED_ISO || "",
  ).trim();
  return isolationDir ? ["--isolation-dir", isolationDir] : [];
}

export function normalizeQueryTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  return clean.startsWith("root//") ? clean.slice("root".length) : clean;
}

export function queryLabelList(node: Record<string, unknown>, key: string): string[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      typeof entry === "string"
        ? normalizeTargetLabel(entry)
        : entry &&
            typeof entry === "object" &&
            typeof (entry as { label?: unknown }).label === "string"
          ? normalizeTargetLabel(String((entry as { label: string }).label))
          : "",
    )
    .filter(Boolean);
}

export function queryComponentLabels(node: Record<string, unknown>): string[] {
  const value = node.components;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { target?: unknown }).target === "string"
        ? normalizeTargetLabel(String((entry as { target: string }).target))
        : "",
    )
    .filter(Boolean);
}
