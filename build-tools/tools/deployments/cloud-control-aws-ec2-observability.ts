#!/usr/bin/env zx-wrapper
import {
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  type EvidenceFreshnessOptions,
} from "./cloud-control-evidence-helpers";
import { REQUIRED_AWS_EC2_ALARMS } from "./cloud-control-aws-ec2-alarms";

export const AWS_EC2_CONTROL_PLANE_OBSERVABILITY_SCHEMA = "aws-ec2-control-plane-observability@1";

export type AwsEc2ControlPlaneObservabilityOptions = EvidenceFreshnessOptions & {
  expectedProvider?: string;
};

export function validateAwsEc2ControlPlaneObservability(
  value: unknown,
  options: AwsEc2ControlPlaneObservabilityOptions,
): string[] {
  const visibility = evidenceObject(value);
  const logSink = evidenceObject(visibility.logSink);
  const history = evidenceObject(visibility.history);
  const errors = freshEvidenceAt(visibility, options)
    ? []
    : ["AWS operational visibility evidence is missing or stale"];
  if (visibility.schemaVersion !== AWS_EC2_CONTROL_PLANE_OBSERVABILITY_SCHEMA) {
    errors.push("AWS operational visibility schemaVersion invalid");
  }
  if (options.expectedProvider && visibility.provider !== options.expectedProvider) {
    errors.push("AWS operational visibility provider identity mismatch");
  }
  if (!["cloudwatch", "reviewed-alternate"].includes(evidenceText(logSink, "kind"))) {
    errors.push("AWS operational visibility missing reviewed log sink");
  }
  if (Number(logSink.retentionDays) <= 0 || !evidenceText(logSink, "accessControlDigest")) {
    errors.push("AWS operational logs missing retention or access-control evidence");
  }
  const unitLogRouting = evidenceObject(visibility.unitLogRouting);
  if (Object.keys(unitLogRouting).length === 0) {
    errors.push("AWS operational visibility missing unit log routing");
  }
  for (const [unit, route] of Object.entries(unitLogRouting)) {
    if (typeof route !== "string" || route.trim() === "") {
      errors.push(`AWS operational visibility unit log route ${unit} is malformed`);
    }
  }
  if (history.readiness !== true || history.workerHeartbeat !== true) {
    errors.push("AWS operational visibility missing readiness or worker-heartbeat history");
  }
  const alarms = Array.isArray(visibility.alarms) ? visibility.alarms : [];
  const alarmIds = new Set(alarms.map((alarm) => evidenceText(alarm, "id")));
  for (const id of REQUIRED_AWS_EC2_ALARMS) {
    if (!alarmIds.has(id)) errors.push(`AWS operational visibility missing alarm ${id}`);
  }
  for (const alarm of alarms) {
    const id = evidenceText(alarm, "id");
    if (id && (!evidenceText(alarm, "target") || !evidenceText(alarm, "action"))) {
      errors.push(`AWS operational visibility alarm ${id} missing target or action`);
    }
  }
  return errors;
}
