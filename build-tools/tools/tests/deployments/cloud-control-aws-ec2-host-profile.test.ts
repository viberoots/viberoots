import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import YAML from "yaml";
import { writeCloudControlSetupBundle } from "../../deployments/cloud-control-setup";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { IMAGE_REF } from "./cloud-control-cutover-fixture";
import { ec2HostProfileInput as input } from "./cloud-control-aws-ec2-host-profile.fixture";
import { runInScratchTemp } from "../lib/test-helpers";
test("AWS EC2 setup renders realizable units podman script and NixOS module reuse", () => {
  const bundle = renderCloudControlSetupBundle(input());
  assert.equal(bundle.files["systemd-podman.units.txt"], undefined);
  const profile = YAML.parse(bundle.files["aws-ec2-profile.yaml"]!);
  assert.equal(profile.preferredHost, "nixos-ec2");
  assert.equal(profile.processes.length, 3);
  assert.deepEqual(
    profile.processes.map((process: any) => process.mounts),
    Array(3).fill(profile.processes[0].mounts),
  );
  const serviceUnit = bundle.files["systemd/deployment-control-plane-service.service"]!;
  assert.match(serviceUnit, /User=10001/);
  assert.match(serviceUnit, /Restart=always/);
  assert.match(serviceUnit, /:\/etc\/deployment-control-plane\/config.yaml:ro/);
  assert.match(serviceUnit, /:\/run\/deployment-control-plane\/credentials:ro/);
  assert.match(serviceUnit, /--publish 0\.0\.0\.0:7780:7780/);
  assert.match(serviceUnit, /\/healthz.*\/readyz/);
  assert.match(serviceUnit, new RegExp(`${escapeRegExp(IMAGE_REF)} service --config`));
  assert.doesNotMatch(serviceUnit, /deployment-control-plane service --config/);
  for (const name of ["worker-1", "worker-2"]) {
    const unit = bundle.files[`systemd/deployment-control-plane-${name}.service`]!;
    assert.doesNotMatch(unit, /--publish/);
    assert.match(unit, new RegExp(`${escapeRegExp(IMAGE_REF)} worker --config`));
    assert.match(unit, new RegExp(`--worker-id ${name}`));
    assert.match(unit, /podman inspect --format "\{\{\.State\.Running\}\}"/);
    assert.doesNotMatch(unit, /--health-command-reference/);
  }
  assert.match(
    bundle.files["nixos/aws-ec2-control-plane-host.example.nix"]!,
    /\.\/deployment-control-plane-container-module\.nix/,
  );
  assert.deepEqual(profile.network.serviceIngress, {
    process: "deployment-control-plane-service",
    systemdUnit: "deployment-control-plane-service.service",
    bindHost: "0.0.0.0",
    bindPort: 7780,
    containerPort: 7780,
    sourceSecurityGroupIds: ["sg-alb"],
    serviceSecurityGroupId: "sg-service",
    loadBalancerSecurityGroupId: "sg-alb",
    targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/cp/1",
  });
});

test("generated NixOS EC2 wrapper evaluates through the existing container module import", async () => {
  await runInScratchTemp("aws-ec2-nixos-wrapper", async (tmp) => {
    await writeCloudControlSetupBundle(input({ outDir: tmp }));
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            nixpkgs.hostPlatform = "x86_64-linux";
            imports = [ ./nixos/aws-ec2-control-plane-host.example.nix ];
            system.stateVersion = "24.11";
          };
        };
      in {
        image = system.config.virtualisation.oci-containers.containers.deployment-control-plane-service.image;
        workerCmd = system.config.virtualisation.oci-containers.containers.deployment-control-plane-worker-1.cmd;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const evaluated = JSON.parse(String(stdout || "{}"));
    assert.equal(evaluated.image, IMAGE_REF);
    assert.deepEqual(evaluated.workerCmd, [
      "worker",
      "--config",
      "/etc/deployment-control-plane/config.yaml",
      "--worker-id",
      "worker-1",
    ]);
  });
});

test("generated activation scripts install bundled systemd units before enabling them", async () => {
  await runInScratchTemp("aws-ec2-activation", async (tmp) => {
    await writeCloudControlSetupBundle(input({ outDir: tmp }));
    const podmanRun = await fsp.readFile(path.join(tmp, "aws-ec2-podman-run.sh"), "utf8");
    const userData = await fsp.readFile(path.join(tmp, "aws-ec2-user-data.sh"), "utf8");
    assert.match(podmanRun, /CONTROL_PLANE_INSTALL_OWNER:-10001:10001/);
    assert.match(userData, /CONTROL_PLANE_INSTALL_OWNER:-10001:10001/);
    const fakeBin = path.join(tmp, "fake-bin");
    const log = path.join(tmp, "systemctl.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "systemctl"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"\n`,
    );
    await fsp.chmod(path.join(fakeBin, "systemctl"), 0o755);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SYSTEMCTL_LOG: log,
    };

    const podmanUnitDir = path.join(tmp, "podman-units");
    const podmanConfigPath = path.join(tmp, "podman-etc/config.yaml");
    const podmanCredentialDir = path.join(tmp, "podman-run/credentials");
    const podmanStateRoot = path.join(tmp, "podman-state");
    await $({
      cwd: tmp,
      env: {
        ...env,
        CONTROL_PLANE_CONFIG_PATH: podmanConfigPath,
        CONTROL_PLANE_CREDENTIAL_DIR: podmanCredentialDir,
        CONTROL_PLANE_INSTALL_OWNER: "skip",
        CONTROL_PLANE_STATE_ROOT: podmanStateRoot,
        SYSTEMD_UNIT_DIR: podmanUnitDir,
      },
    })`bash aws-ec2-podman-run.sh`;
    assert.equal(
      await fsp.readFile(podmanConfigPath, "utf8"),
      await fsp.readFile(path.join(tmp, "config.yaml"), "utf8"),
    );
    assert.ok(await exists(podmanCredentialDir));
    assert.equal((await fsp.stat(podmanCredentialDir)).mode & 0o777, 0o750);
    assert.ok(await exists(path.join(podmanStateRoot, "records")));
    assert.ok(await exists(path.join(podmanStateRoot, "artifacts")));
    assert.deepEqual((await fsp.readdir(podmanUnitDir)).sort(), [
      "deployment-control-plane-service.service",
      "deployment-control-plane-worker-1.service",
      "deployment-control-plane-worker-2.service",
    ]);

    const userDataUnitDir = path.join(tmp, "user-data-units");
    const userDataConfigPath = path.join(tmp, "user-data-etc/config.yaml");
    const userDataCredentialDir = path.join(tmp, "user-data-run/credentials");
    const userDataStateRoot = path.join(tmp, "user-data-state");
    await $({
      cwd: tmp,
      env: {
        ...env,
        CONTROL_PLANE_CONFIG_PATH: userDataConfigPath,
        CONTROL_PLANE_CREDENTIAL_DIR: userDataCredentialDir,
        CONTROL_PLANE_INSTALL_OWNER: "skip",
        CONTROL_PLANE_STATE_ROOT: userDataStateRoot,
        SYSTEMD_UNIT_DIR: userDataUnitDir,
        VIBEROOTS_CONTROL_PLANE_BUNDLE: tmp,
      },
    })`bash aws-ec2-user-data.sh`;
    assert.equal(
      await fsp.readFile(userDataConfigPath, "utf8"),
      await fsp.readFile(path.join(tmp, "config.yaml"), "utf8"),
    );
    assert.ok(await exists(userDataCredentialDir));
    assert.ok(await exists(path.join(userDataStateRoot, "records")));
    assert.deepEqual((await fsp.readdir(userDataUnitDir)).sort(), [
      "deployment-control-plane-service.service",
      "deployment-control-plane-worker-1.service",
      "deployment-control-plane-worker-2.service",
    ]);
    const systemctl = await fsp.readFile(log, "utf8");
    assert.match(systemctl, /daemon-reload/);
    assert.match(systemctl, /enable --now deployment-control-plane-service\.service/);
    assert.match(systemctl, /enable --now deployment-control-plane-worker-1\.service/);
    assert.match(systemctl, /enable --now deployment-control-plane-worker-2\.service/);
  });
});

test("AWS EC2 runbook process start uses generated host activation artifacts", () => {
  const bundle = renderCloudControlSetupBundle(input());
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const phase = commands.phases.find((entry: any) => entry.id === "process-start");
  assert.equal(phase.commands.length, 3);
  assert.match(phase.commands[0].command, /bash "\$PROFILE_ROOT\/aws-ec2-podman-run\.sh"/);
  assert.doesNotMatch(JSON.stringify(phase.commands), /deployment-control-plane service --config/);
  assert.doesNotMatch(JSON.stringify(phase.commands), /deployment-control-plane worker --config/);
  assert.ok(
    phase.commands[0].inputs.includes(
      "$PROFILE_ROOT/systemd/deployment-control-plane-service.service",
    ),
  );
  assert.ok(
    phase.commands[1].command.includes(
      "systemctl enable --now deployment-control-plane-worker-1.service",
    ),
  );
});

test("AWS EC2 setup renders observability and host-profile evidence contract", () => {
  const bundle = renderCloudControlSetupBundle(input());
  const observability = JSON.parse(bundle.files["aws-ec2-observability-profile.json"]!);
  assert.equal(observability.logSink.kind, "cloudwatch");
  assert.equal(observability.history.readiness, true);
  assert.equal(observability.history.workerHeartbeat, true);
  assert.deepEqual(
    observability.alarms.map((alarm: any) => alarm.id),
    [...REQUIRED_AWS_EC2_ALARMS],
  );
  const contract = JSON.parse(bundle.files["aws-ec2-host-profile-evidence.contract.json"]!);
  assert.equal(contract.requiredWorkerCount, 2);
  assert.ok(contract.requiredFields.includes("registryPullProof"));
  assert.doesNotMatch(JSON.stringify(bundle.files), /postgres:\/\/|BEGIN .*PRIVATE KEY|AKIA/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function exists(file: string): Promise<boolean> {
  return fsp.access(file).then(
    () => true,
    () => false,
  );
}
