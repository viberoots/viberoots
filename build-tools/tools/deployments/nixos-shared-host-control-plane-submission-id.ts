#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";

export function createNixosSharedHostSubmissionId(): string {
  return `cp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}
