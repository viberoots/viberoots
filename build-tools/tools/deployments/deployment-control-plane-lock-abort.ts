#!/usr/bin/env zx-wrapper
import type { ControlPlaneLockAbortReason } from "./nixos-shared-host-control-plane-store.ts";

export function throwLockAbort(reason: ControlPlaneLockAbortReason): never {
  throw Object.assign(
    new Error(`shared control-plane wait ended because the run was ${reason.replaceAll("_", " ")}`),
    { code: reason },
  );
}
