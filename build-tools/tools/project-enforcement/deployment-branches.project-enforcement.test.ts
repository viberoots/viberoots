#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  DEPLOYMENT_SOURCE_FILE_EXTENSIONS,
  scanDeploymentEnvironmentBranchText,
} from "../deployments/deployment-environment-branch-scanner";
import { resolveProjectScanContext } from "../lib/workspace-roots";
import { listProjectFiles } from "./project-file-tree";

const context = resolveProjectScanContext();
const root = path.join(context.projectsRoot, "deployments");
const files = await listProjectFiles(root, (file) =>
  DEPLOYMENT_SOURCE_FILE_EXTENSIONS.has(path.extname(file)),
);
const errors = (
  await Promise.all(
    files.map(async (file) =>
      scanDeploymentEnvironmentBranchText(
        path.relative(context.workspaceRoot, file).replaceAll(path.sep, "/"),
        await fsp.readFile(file, "utf8"),
      ),
    ),
  )
).flat();
if (errors.length > 0) throw new Error(errors.join("\n"));
