#!/usr/bin/env zx-wrapper
import { scanProcessInspectionTree } from "../lib/process-inspection-scanner";
import { resolveProjectScanContext } from "../lib/workspace-roots";

const context = resolveProjectScanContext();
const hits = await scanProcessInspectionTree({
  root: context.projectsRoot,
  pathPrefix: "projects",
});
if (hits.length > 0) {
  throw new Error(
    [
      "Found direct process-inspection command usage outside reviewed helper modules.",
      "Route new usage through an existing process helper or add a narrowly reviewed allowlist entry.",
      ...hits.slice(0, 120),
    ].join("\n"),
  );
}
