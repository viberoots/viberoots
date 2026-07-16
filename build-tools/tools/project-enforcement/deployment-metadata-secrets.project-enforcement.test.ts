#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  DEPLOYMENT_METADATA_FILE_PATTERN,
  scanDeploymentMetadataSecrets,
} from "../deployments/deployment-metadata-secret-scanner";
import { resolveProjectScanContext } from "../lib/repo";
import { listProjectFiles } from "./project-file-tree";

const context = resolveProjectScanContext();
const root = path.join(context.projectsRoot, "deployments");
const files = await listProjectFiles(root, (file) => DEPLOYMENT_METADATA_FILE_PATTERN.test(file));
const violations = (
  await Promise.all(
    files.map(async (file) =>
      scanDeploymentMetadataSecrets(
        path.relative(context.workspaceRoot, file).replaceAll(path.sep, "/"),
        await fsp.readFile(file, "utf8"),
      ),
    ),
  )
).flat();
if (violations.length > 0) throw new Error(violations.join("\n"));
