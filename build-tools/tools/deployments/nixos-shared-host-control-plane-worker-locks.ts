#!/usr/bin/env zx-wrapper
import {
  acquireBackendControlPlaneLock,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { nixosSharedHostLockScopes } from "./nixos-shared-host-components";

export async function acquireBackendNixosSharedHostLocks(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deployment: Parameters<typeof nixosSharedHostLockScopes>[0];
  shouldAbort?: () => Promise<"cancelled" | "superseded" | "no_longer_admitted" | null>;
}) {
  const releases: Array<() => Promise<void>> = [];
  const assertions: Array<() => Promise<void>> = [];
  let fencingToken: string | undefined;
  try {
    for (const lockScope of nixosSharedHostLockScopes(opts.deployment)) {
      const lock = await acquireBackendControlPlaneLock(opts.backend, lockScope, {
        ...(opts.shouldAbort ? { shouldAbort: opts.shouldAbort } : {}),
      });
      if (!fencingToken) fencingToken = lock.fencingToken;
      assertions.push(lock.assertCurrentAuthority);
      releases.push(lock.release);
    }
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return {
    fencingToken,
    assertCurrentAuthority: async () => {
      for (const assertCurrentAuthority of assertions) await assertCurrentAuthority();
    },
    release: async () => {
      for (const release of releases.reverse()) await release();
    },
  };
}
