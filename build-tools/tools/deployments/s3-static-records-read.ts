#!/usr/bin/env zx-wrapper
import { readVersionedJson } from "./deployment-schema-compat.ts";
import { S3_STATIC_RECORD_SCHEMA, type S3StaticDeployRecord } from "./s3-static-records.ts";

export async function readS3StaticDeployRecord(recordPath: string): Promise<S3StaticDeployRecord> {
  return await readVersionedJson(recordPath, {
    kind: "s3-static deploy record",
    currentSchemaVersion: S3_STATIC_RECORD_SCHEMA,
    validateCurrent: (raw): raw is S3StaticDeployRecord =>
      typeof raw.deployRunId === "string" && typeof raw.deploymentLabel === "string",
  });
}
