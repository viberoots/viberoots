#!/usr/bin/env zx-wrapper
import { PROJECT_SOURCE_FILES_SCOPE } from "../dev/file-size-lint-scopes";
import { scanFileSizeOffenders } from "../dev/file-size-scanner";
import { listFilesMatching } from "../dev/file-size-globs";
import { resolveProjectScanContext } from "../lib/workspace-roots";

const context = resolveProjectScanContext();
const candidates = await listFilesMatching({
  root: context.workspaceRoot,
  include: PROJECT_SOURCE_FILES_SCOPE.include,
  exclude: PROJECT_SOURCE_FILES_SCOPE.exclude,
});
const offenders = await scanFileSizeOffenders({
  root: context.workspaceRoot,
  candidates,
  threshold: 250,
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
