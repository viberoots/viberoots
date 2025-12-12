## C++ Provider Sync → No-op (PR 2)

This repo no longer generates or consumes C++ provider rules. C++ targets declare `nixpkg_deps` at call sites, macros stamp `nixpkg:` labels, and the planner consumes those labels directly.

- What changed:
  - C++ provider sync is a no-op; `tools/buck/sync-providers.ts --lang=cpp` does nothing.
  - The install glue skips the C++ sync step.
  - New inspector: `tools/buck/inspect-cpp-attrs.ts` prints effective `nixpkg:` attrs per target.
- What did not change:
  - Node importer-scoped providers remain.
  - Go provider sync remains for patch-driven invalidation.
- How to inspect:
  - `node tools/buck/inspect-cpp-attrs.ts --json`
  - `node tools/buck/inspect-cpp-attrs.ts --target //<pkg>:<name>`

Rationale and full context: see `drop-cpp-provider.md` (Target State and PR 2).
