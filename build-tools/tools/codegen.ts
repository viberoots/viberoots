#!/usr/bin/env zx-wrapper
// build-tools/tools/codegen.ts — central code generation entrypoint
//
// What belongs here vs. as Buck-native codegen?
//
// Put it HERE when:
// - The generator is a cross-repo or workspace-level tool we invoke directly (zx/Node), not a
//   per-target Buck action. Examples:
//   - Running a single protobuf/OpenAPI pass for the repo that writes sources under versioned
//     directories (e.g., tools write to libs/**/gen or similar), using write-if-changed.
//   - Re-building a monolithic SDK from a repo-local schema that isn't expressed as a Buck rule.
//   - Any glue generation that must exist BEFORE the Buck graph is exported so imports are visible.
//
// Put it IN BUCK (as native rules) when:
// - The generated files are per-target artifacts that should participate in Buck’s graph, caching
//   and invalidation. Examples:
//   - A :generated_go library produced from a specific .proto set; downstream depends on :generated_go.
//   - Codegen that consumes other targets’ outputs (Buck handles scheduling), e.g., a rule that
//     transforms a schema JSON output into TypeScript types.
//
// Why a separate stage?
// - Our pipeline is staged: Codegen → Export Graph → Sync Providers → Generate auto_map → Guard → Build.
// - Doing external (non-Buck) codegen first ensures the exporter sees real sources and labels are
//   accurate.
// - Buck-native codegen should remain Buck rules; this script is a no-op unless the repo opts in to
//   additional zx-driven generators.
//
// Behavior
// - Default: no-op and exit 0 (safe on repos without external generators).
// - If CODEGEN_ENABLE=1, you may add repo-specific steps below using write-if-changed and
//   deterministic ordering. Keep each step optional and tolerant of missing inputs.

import fs from "fs-extra";

const ENABLE = process.env.CODEGEN_ENABLE === "1";
const VERBOSE = process.env.CODEGEN_VERBOSE === "1";

async function main() {
  if (!ENABLE) {
    console.log("codegen: OK");
    return;
  }
  // Example scaffold for future steps (kept disabled by default):
  // await maybeRunProto();
  // await maybeRunOpenAPI();
  // await maybeRunGraphQL();
  console.log("codegen: OK (no-op; CODEGEN_ENABLE=1 but no steps configured)");
}

// Example structure for a future step (illustrative only):
// async function maybeRunProto() {
//   const protoDir = "schemas/proto";
//   if (!(await fs.pathExists(protoDir))) {
//     if (VERBOSE) console.log("proto: skipped (no schemas/proto)");
//     return;
//   }
//   // Run your generator here and write files using write-if-changed logic
//   // so re-runs are idempotent and don’t churn the working tree.
// }

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
