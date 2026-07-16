#!/usr/bin/env zx-wrapper
import { findFileSizeOffenders, PROJECT_SOURCE_FILES_SCOPE } from "../dev/file-size-lint";
import { resolveProjectScanContext } from "../lib/repo";

const context = resolveProjectScanContext();
const offenders = await findFileSizeOffenders({
  root: context.workspaceRoot,
  changedOnly: false,
  threshold: 250,
  failOnOffenders: true,
  allowKnown: false,
  scope: PROJECT_SOURCE_FILES_SCOPE,
});
if (offenders.length > 0) {
  throw new Error(
    [
      `project file-size enforcement found ${offenders.length} file(s) over 250 lines`,
      ...offenders.map(({ file, lines }) => `  ${file}: ${lines} lines`),
    ].join("\n"),
  );
}
