#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";

export { validateAwsProviderCapabilityEvidence } from "./control-plane-container-live-smoke-aws-provider.helpers";

export function awsTopologyInputs(env: NodeJS.ProcessEnv): string[] {
  if (env.VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY !== "1") return [];
  return [
    "VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_AWS_SUBNET_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_AWS_SECURITY_GROUP_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_AWS_DNS_TLS_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_INGRESS_URL",
    "VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH",
    "VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH",
    "VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE",
    "VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE",
  ];
}

export async function validateOptionalAwsTopology(
  env: Record<string, string>,
  token: string,
  assertOkJson: (url: URL, label: string, token?: string) => Promise<unknown>,
) {
  if (env.VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY !== "1") return;
  for (const name of awsTopologyInputs(env)) {
    assert.ok(env[name], `${name} is required for AWS topology live smoke`);
  }
  await validateAwsEvidenceFiles(env);
  const ingress = new URL(env.VBR_CONTROL_PLANE_LIVE_INGRESS_URL);
  assert.equal(ingress.protocol, "https:");
  await assertOkJson(new URL("/healthz", ingress), "ingress health");
  await assertOkJson(new URL("/readyz", ingress), "ingress readiness", token);
  const workers = (await assertOkJson(
    new URL("/api/v1/worker-heartbeats", ingress),
    "ingress workers",
    token,
  )) as { workers?: unknown[] };
  assert.ok(Array.isArray(workers.workers) && workers.workers.length >= 2);
  await validateAwsRuntimeEvidenceFiles(env);
}

export async function validateAwsRuntimeEvidenceFiles(env: Record<string, string>) {
  const db = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE);
  const s3 = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE);
  const shutdown = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE);
  const topology = await readOptionalTopologyEvidence(env);
  validateEc2Runtime(db.runtime, "Postgres");
  validateEc2Runtime(s3.runtime, "S3");
  validateEc2Runtime(shutdown.runtime, "shutdown");
  const service = validateProcessIdentity(db.serviceProcess, "service", db.runtime);
  const worker = validateProcessIdentity(db.workerProcess, "worker", db.runtime);
  validateSameProcess(service, validateProcessIdentity(s3.serviceProcess, "service", s3.runtime));
  validateSameProcess(worker, validateProcessIdentity(s3.workerProcess, "worker", s3.runtime));
  validateSameProcess(
    worker,
    validateProcessIdentity(shutdown.workerProcess, "worker", shutdown.runtime),
  );
  assert.equal(service.imageDigest, worker.imageDigest);
  assert.equal(service.configDigest, worker.configDigest);
  validatePostgresEvidence(db.postgres, env.VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH, service);
  validateS3RuntimeEvidence(s3.s3, env.VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH, worker);
  validateShutdownEvidence(shutdown.shutdown, worker);
  validateInstanceTopology([service.instanceId, worker.instanceId], topology);
}

async function validateAwsEvidenceFiles(env: Record<string, string>) {
  const subnets = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_SUBNET_EVIDENCE_FILE);
  const groups = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_SECURITY_GROUP_EVIDENCE_FILE);
  const s3 = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_EVIDENCE_FILE);
  const dnsTls = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_DNS_TLS_EVIDENCE_FILE);
  assert.ok(
    Array.isArray(subnets.subnetIds) &&
      subnets.subnetIds.every((id: string) => /^subnet-/.test(id)),
  );
  assert.ok(
    Array.isArray(groups.securityGroupIds) &&
      groups.securityGroupIds.every((id: string) => /^sg-/.test(id)),
  );
  assert.match(String(s3.endpointId || s3.endpointDnsName || ""), /^(vpce-|.+s3.+amazonaws\.com)/);
  assert.equal(dnsTls.hostname, new URL(env.VBR_CONTROL_PLANE_LIVE_INGRESS_URL).hostname);
  assert.ok(dnsTls.certificateArn || dnsTls.validCertificate === true);
}

async function readOptionalTopologyEvidence(env: Record<string, string>) {
  if (!env.VBR_CONTROL_PLANE_LIVE_AWS_SUBNET_EVIDENCE_FILE) return undefined;
  return {
    subnets: await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_SUBNET_EVIDENCE_FILE),
    groups: await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_SECURITY_GROUP_EVIDENCE_FILE),
  };
}

function validateEc2Runtime(value: unknown, label: string) {
  const runtime = asRecord(value, `${label} runtime`);
  assert.equal(runtime.provider, "aws-ec2");
  assert.match(String(runtime.instanceId || ""), /^i-[0-9a-f]+$/);
  assert.match(String(runtime.availabilityZone || ""), /^[a-z]{2}-[a-z]+-\d[a-z]$/);
  assert.match(String(runtime.source || ""), /^(ec2-instance-metadata|ssm-instance)$/);
}

function validateProcessIdentity(value: unknown, role: string, runtimeValue: unknown) {
  const runtime = asRecord(runtimeValue, `${role} runtime`);
  const process = asRecord(value, `${role} process`);
  assert.equal(process.role, role);
  assert.equal(process.instanceId, runtime.instanceId);
  assert.match(String(process.processId || ""), /^[a-z0-9][a-z0-9._:-]+$/i);
  assert.match(String(process.imageDigest || ""), /^sha256:[0-9a-f]{64}$/);
  assert.match(String(process.configDigest || ""), /^sha256:[0-9a-f]{64}$/);
  assert.match(String(process.unitName || ""), /control-plane/);
  return process;
}

function validateSameProcess(left: Record<string, unknown>, right: Record<string, unknown>) {
  for (const key of ["role", "instanceId", "processId", "imageDigest", "configDigest"]) {
    assert.equal(left[key], right[key], `${key} must match across runtime evidence`);
  }
}

function validatePostgresEvidence(
  value: unknown,
  selectedPath: string,
  service: Record<string, unknown>,
) {
  assert.match(selectedPath, /^(public|privatelink)$/);
  const postgres = asRecord(value, "Postgres evidence");
  assert.equal(postgres.success, true);
  assert.equal(postgres.selectedPath, selectedPath);
  assert.equal(postgres.checkedByProcessId, service.processId);
  assert.match(String(postgres.host || ""), /supabase\.(co|com)|supabase|postgres/i);
  assert.equal(postgres.tls, true);
  if (selectedPath === "privatelink") {
    assert.match(String(postgres.vpcEndpointId || ""), /^vpce-/);
    assert.match(String(postgres.resolvedAddressType || ""), /^(private|vpc-endpoint)$/);
  } else {
    assert.equal(postgres.vpcEndpointId || "", "");
    assert.equal(postgres.resolvedAddressType, "public");
  }
}

function validateS3RuntimeEvidence(
  value: unknown,
  selectedPath: string,
  worker: Record<string, unknown>,
) {
  assert.match(selectedPath, /^(gateway|interface)$/);
  const s3 = asRecord(value, "S3 evidence");
  assert.equal(s3.success, true);
  assert.equal(s3.selectedEndpointPath, selectedPath);
  assert.equal(s3.checkedByProcessId, worker.processId);
  assert.match(String(s3.endpointId || ""), /^vpce-/);
  assert.ok(Array.isArray(s3.checkedOperations));
  for (const op of ["PUT", "GET", "HEAD"]) assert.ok(s3.checkedOperations.includes(op));
  if (selectedPath === "gateway") {
    assert.ok(Array.isArray(s3.routeTableIds) && s3.routeTableIds.length > 0);
  } else {
    assert.match(String(s3.endpointDnsName || ""), /s3.*amazonaws\.com/);
  }
}

function validateShutdownEvidence(value: unknown, worker: Record<string, unknown>) {
  const shutdown = asRecord(value, "worker shutdown evidence");
  assert.equal(shutdown.success, true);
  assert.equal(shutdown.graceful, true);
  assert.equal(shutdown.workerProcessId, worker.processId);
  assert.match(String(shutdown.signal || ""), /^(SIGTERM|systemd-stop)$/);
  assert.ok(shutdown.heartbeatBefore);
  const heartbeatAfter = asRecord(shutdown.heartbeatAfter, "post-shutdown worker state");
  assert.equal(heartbeatAfter.workerPresent, false);
}

function validateInstanceTopology(
  instanceIds: unknown[],
  topology?: { subnets: Record<string, unknown>; groups: Record<string, unknown> },
) {
  if (!topology) return;
  for (const instanceId of new Set(instanceIds.map(String))) {
    const subnetInstance = findInstance(topology.subnets.instances, instanceId);
    const groupInstance = findInstance(topology.groups.instances, instanceId);
    assert.ok(subnetInstance, `${instanceId} missing from subnet evidence`);
    assert.ok(groupInstance, `${instanceId} missing from security-group evidence`);
    assert.match(String(subnetInstance.subnetId || ""), /^subnet-/);
    assert.ok(Array.isArray(groupInstance.securityGroupIds));
    assert.ok(groupInstance.securityGroupIds.every((id: string) => /^sg-/.test(id)));
  }
}

function findInstance(instances: unknown, instanceId: string) {
  assert.ok(Array.isArray(instances), "AWS topology evidence must list runtime instances");
  return instances.find((entry) => asRecord(entry, "topology instance").instanceId === instanceId);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} is required`);
  return value as Record<string, unknown>;
}

async function readJsonFile(file: string) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}
