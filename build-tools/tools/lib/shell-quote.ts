#!/usr/bin/env zx-wrapper
export function shSingleQuote(value: string): string {
  return `'${String(value || "").replaceAll("'", `'\"'\"'`)}'`;
}
