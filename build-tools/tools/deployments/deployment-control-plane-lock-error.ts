#!/usr/bin/env zx-wrapper
export function lockErrorContext(error: unknown) {
  const code = (error as { code?: string })?.code;
  const waitAborted =
    code === "cancelled" || code === "superseded" || code === "no_longer_admitted";
  return {
    lockRejected: code !== "lock_timeout",
    lockTimeout: code === "lock_timeout",
    waitAborted,
    waitAbortReason: waitAborted ? code : undefined,
  };
}
