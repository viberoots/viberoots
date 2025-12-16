#!/usr/bin/env zx-wrapper
/**
 * C++ provider sync is intentionally a no-op.
 *
 * C++ patch invalidation is package-local via `patches/cpp` files included in target `srcs`.
 * nixpkgs deps are expressed via `nixpkg:` labels and consumed by the planner / auto-map.
 *
 * See: `drop-cpp-provider.md` and `docs/handbook/cpp-pr2-migration.md`.
 */
export async function syncCppProviders(): Promise<void> {
  console.info("[providers] C++ provider sync is a no-op — see drop-cpp-provider.md (PR 2).");
}
