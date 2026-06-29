# Build Optimization Design

This document describes a safe design for reducing repeated `b` work in viberoots-enabled
workspaces without sacrificing correctness. The focus is prebuild freshness: deciding whether
generated Buck workspace state needs to be refreshed before Buck builds targets.

## Goals

- Make back-to-back builds closer to no-op when generated workspace state is already fresh.
- Preserve correctness when source files, lockfiles, config, or generator behavior changes.
- Keep the design scalable as workspaces grow to thousands of targets.
- Avoid manual freshness manifests. Developers should not maintain dependency lists by hand.
- Keep Buck responsible for target rebuild decisions. Prebuild freshness should only answer whether
  generated workspace state needs regeneration.

## Non-Goals

- Do not replace Buck action invalidation.
- Do not fingerprint every source file or every target artifact.
- Do not require developers to edit generated state or manifest files.
- Do not hide uncertainty with fallback behavior. When freshness cannot be proven, refresh.

## Implemented Approach

Use an automatically generated prebuild fingerprint record.

After a successful glue/materialize refresh, write a machine-owned file under
`.viberoots/workspace/buck/prebuild-fingerprint.json`, for example:

```json
{
  "schema": 1,
  "generatedAt": "2026-06-28T00:00:00.000Z",
  "inputs": [
    {
      "path": "viberoots/build-tools/tools/buck/glue-pipeline.ts",
      "hash": "sha256-..."
    },
    {
      "path": "projects/apps/example/pnpm-lock.yaml",
      "hash": "sha256-..."
    }
  ],
  "outputs": [
    ".viberoots/workspace/buck/graph.json",
    ".viberoots/workspace/buck/node-lock-index.json"
  ]
}
```

The record is evidence from the last successful refresh, not source of truth. The source of truth is
the code-owned discovery function plus the current filesystem.

## Freshness Check

Before skipping glue/materialize, the prebuild guard should:

1. Discover current prebuild inputs with a single code-owned function.
2. Read the previous fingerprint record.
3. Refresh if the record is missing, malformed, or has an unknown schema.
4. Refresh if any declared output is missing.
5. Refresh if the discovered input set differs from the recorded input set.
6. Refresh if any recorded input hash differs from the current file hash.
7. Refresh if existing content-level backstops, such as `node-lock-index.json` versus `graph.json`,
   detect drift.
8. Skip only when every check proves the generated workspace state is fresh.

The default on uncertainty is refresh.

## Input Discovery

The focused discovery module is `build-tools/tools/buck/prebuild/input-discovery.ts`:

```ts
export async function discoverPrebuildInputs(root: string): Promise<string[]> {
  // Return stable, root-relative paths.
}
```

Both the fingerprint writer and checker call this same function. There should be no duplicated input
lists.

Discovery should include files that affect generated Buck workspace state, such as:

- viberoots glue/prebuild generator source files
- build-system config files read by glue/materialize
- package manager lockfiles and package manifests that affect provider generation
- workspace metadata used to discover importer roots
- generated sidecars that are intentionally read back by prebuild logic

Discovery should not include broad application source trees unless a prebuild generator actually reads
them. If a future generator needs broad source data, it should expose a narrow summary input instead
of forcing prebuild freshness to scan the whole repository.

## Scalability Boundary

This design scales when the fingerprint covers prebuild inputs, not build target inputs.

For a workspace with thousands of targets, the discovered input set should grow with the number of
importers, lockfiles, and build-system configuration files. It should not grow with every application
source file or every Buck output. Buck already handles target-level invalidation.

Expected complexity:

- Discovery: proportional to known importer/config roots.
- Hashing: proportional to the number and size of prebuild input files.
- Skip decision: a small JSON parse plus stable set/hash comparison.

If discovery becomes proportional to all repository files, the design has crossed the boundary and
should be corrected before landing.

## Safety Rules

- Unknown schema refreshes.
- Missing fingerprint refreshes.
- Malformed fingerprint refreshes.
- Missing input refreshes unless the same input is no longer discovered.
- Newly discovered input refreshes.
- Missing output refreshes.
- Hash mismatch refreshes.
- Discovery failure refreshes and reports a diagnostic.
- Hashing failure refreshes and reports a diagnostic.

The guard may optimize only when it has positive evidence. It should never skip because a check could
not run.

## Generated State Ownership

The fingerprint file is generated state. Developers should not edit it.

The reviewable contract lives in:

- the discovery module
- the fingerprint schema
- the freshness checker
- focused tests that exercise stale and fresh cases

This keeps the system maintainable without requiring a manually maintained manifest.

## Validation

Focused tests should cover:

- fresh fingerprint skips glue/materialize freshness repair
- changed input hash refreshes
- added discovered input refreshes
- removed discovered input refreshes
- missing output refreshes
- malformed record refreshes
- unknown schema refreshes
- sidecar content drift still refreshes

The focused fingerprint tests live in
`build-tools/tools/tests/prebuild/fingerprint.test.ts`. A small integration-style test that runs a
refresh, runs the guard again, and verifies the second run uses the skip path is still useful if the
prebuild guard grows more complex. Keep that test small so it does not become a broad build-suite
substitute.

## Tradeoffs

Benefits:

- Correctness does not depend on mtimes alone.
- Developers do not maintain manifest files.
- The no-op path is faster when generated state is demonstrably fresh.
- The input contract is centralized and testable.

Costs:

- Each prebuild guard run must discover and hash prebuild inputs.
- The discovery module becomes a reviewed build-system contract.
- A missed discovery input can still cause stale generated state, so discovery must stay narrow,
  explicit, and covered by tests.

The current implementation keeps content checks such as `node-lock-index.json` versus `graph.json`
as backstops. That is intentional: the fingerprint is the main skip proof, and targeted content
checks protect known generated sidecars whose correctness matters to downstream Buck behavior.
