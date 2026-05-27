#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { operatorErrorFields } from "./deployment-control-plane-redaction";

export type ControlPlaneProcessLogger = (entry: Record<string, unknown>) => void;

export function createControlPlaneCorrelationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function writeControlPlaneProcessLog(
  logger: ControlPlaneProcessLogger | undefined,
  entry: {
    event: string;
    correlationId: string;
    mode: "service" | "worker";
    instanceId?: string;
    workerId?: string;
    error?: unknown;
    fields?: Record<string, unknown>;
  },
) {
  const payload: Record<string, unknown> = {
    schemaVersion: "deployment-control-plane-process-log@1",
    event: entry.event,
    correlationId: entry.correlationId,
    mode: entry.mode,
    ...(entry.instanceId ? { instanceId: entry.instanceId } : {}),
    ...(entry.workerId ? { workerId: entry.workerId } : {}),
    ...(entry.fields || {}),
    ...(entry.error ? operatorErrorFields(errorText(entry.error)) : {}),
  };
  (logger || defaultProcessLogger)(dropUndefined(payload));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultProcessLogger(entry: Record<string, unknown>) {
  console.error(JSON.stringify(entry));
}

function dropUndefined(entry: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}
