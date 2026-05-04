#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";

export function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

export function readStringArray(node: GraphNode, key: string): string[] {
  return Array.isArray(node[key])
    ? node[key].filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
}

export function readStringRecord(node: GraphNode, key: string): Record<string, string> {
  const value = node[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([entryKey, entryValue]) => typeof entryKey === "string" && typeof entryValue === "string",
      )
      .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
      .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
  );
}
