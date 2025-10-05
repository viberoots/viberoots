#!/usr/bin/env zx-wrapper
import { printSkip } from "./errors";

export class SkipError extends Error {
  reason: import("./errors").SkipReason;
  details?: string;
  constructor(reason: import("./errors").SkipReason, details?: string) {
    super(`[skip] ${reason}${details ? ": " + details : ""}`);
    this.reason = reason;
    this.details = details;
    this.name = "SkipError";
  }
}

export async function runMain(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    // Known skip types: print skip and exit 0
    if (e && (e.name === "SkipError" || e.constructor?.name === "SkipError")) {
      const reason = (e.reason as any) || "not-applicable";
      const details = (e.details as any) || undefined;
      printSkip(reason, details);
      process.exit(0);
      return;
    }
    // Optional: honor explicit exitCode on error objects
    if (typeof e?.exitCode === "number") {
      console.error(String(e?.message || e));
      process.exit(Number(e.exitCode));
      return;
    }
    // Fallback: non-skip errors bubble up with exit 1
    console.error(e);
    process.exit(1);
  }
}
