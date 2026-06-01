#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { publicAwsTopology } from "./cloud-control-aws-topology.fixture";

export async function writeAwsRuntimeEvidence(
  overrides: {
    mismatchedS3Worker?: boolean;
    mismatchedShutdownWorker?: boolean;
    omitRuntimeTopology?: boolean;
  } = {},
) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-aws-runtime-evidence-"));
  const runtime = runtimeFixture();
  const serviceProcess = processFixture("service", "service-main", runtime.instanceId);
  const workerProcess = processFixture("worker", "worker-a", runtime.instanceId);
  const s3WorkerProcess = overrides.mismatchedS3Worker
    ? processFixture("worker", "worker-other", runtime.instanceId)
    : workerProcess;
  const dbFile = path.join(tmp, "db.json");
  const s3File = path.join(tmp, "s3.json");
  const shutdownFile = path.join(tmp, "shutdown.json");
  const profileFile = path.join(tmp, "aws-ec2-profile.yaml");
  const topologyFile = path.join(tmp, "aws-topology.json");
  const subnetFile = path.join(tmp, "subnets.json");
  const groupFile = path.join(tmp, "groups.json");
  await writeJson(dbFile, {
    runtime,
    serviceProcess,
    workerProcess,
    postgres: {
      success: true,
      selectedPath: "privatelink",
      checkedByProcessId: serviceProcess.processId,
      host: "db.supabase.co",
      tls: true,
      vpcEndpointId: "vpce-0123456789abcdef0",
      resolvedAddressType: "private",
    },
  });
  await writeJson(s3File, {
    runtime,
    serviceProcess,
    workerProcess: s3WorkerProcess,
    s3: {
      success: true,
      selectedEndpointPath: "gateway",
      checkedByProcessId: s3WorkerProcess.processId,
      endpointId: "vpce-abcdef01234567890",
      checkedOperations: ["PUT", "GET", "HEAD"],
      routeTableIds: ["rtb-0123456789abcdef0"],
    },
  });
  await writeJson(shutdownFile, {
    runtime,
    workerProcess,
    shutdown: {
      success: true,
      graceful: true,
      workerProcessId: overrides.mismatchedShutdownWorker
        ? "worker-other"
        : workerProcess.processId,
      signal: "SIGTERM",
      heartbeatBefore: { workerPresent: true },
      heartbeatAfter: { workerPresent: false },
    },
  });
  const topologyInstances = overrides.omitRuntimeTopology ? [] : [serviceProcess, workerProcess];
  await fsp.writeFile(profileFile, "ec2HostMode: external-reviewed-host\n", "utf8");
  await writeJson(topologyFile, publicAwsTopology());
  await writeJson(subnetFile, {
    subnetIds: ["subnet-0123456789abcdef0"],
    instances: topologyInstances.map((process) => ({
      instanceId: process.instanceId,
      subnetId: "subnet-0123456789abcdef0",
    })),
  });
  await writeJson(groupFile, {
    securityGroupIds: ["sg-0123456789abcdef0"],
    instances: topologyInstances.map((process) => ({
      instanceId: process.instanceId,
      securityGroupIds: ["sg-0123456789abcdef0"],
    })),
  });
  return {
    VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE: dbFile,
    VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE: s3File,
    VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE: shutdownFile,
    VBR_CONTROL_PLANE_LIVE_AWS_EC2_PROFILE_FILE: profileFile,
    VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY_EVIDENCE_FILE: topologyFile,
    VBR_CONTROL_PLANE_LIVE_AWS_SUBNET_EVIDENCE_FILE: subnetFile,
    VBR_CONTROL_PLANE_LIVE_AWS_SECURITY_GROUP_EVIDENCE_FILE: groupFile,
    VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH: "privatelink",
    VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH: "gateway",
    VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY: "1",
  };
}

function runtimeFixture() {
  return {
    provider: "aws-ec2",
    instanceId: "i-0123456789abcdef0",
    availabilityZone: "us-east-1a",
    source: "ec2-instance-metadata",
  };
}

function processFixture(role: string, processId: string, instanceId: string) {
  return {
    role,
    processId,
    instanceId,
    imageDigest: `sha256:${"a".repeat(64)}`,
    configDigest: `sha256:${"b".repeat(64)}`,
    unitName: `deployment-control-plane-${role}.service`,
  };
}

async function writeJson(file: string, value: unknown) {
  await fsp.writeFile(file, JSON.stringify(value));
}
