#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  createProductionOpenTofuApplyAdapter,
  OpenTofuApplyMismatchError,
  runOpenTofuReviewedApply,
} from "../../deployments/opentofu-apply";
import { maybeRunOpenTofuReviewedApply } from "../../deployments/opentofu-apply-orchestration";
import {
  PLAN_FINGERPRINT,
  STACK_CONFIG_FINGERPRINT,
  fakeSecretRuntime,
  provisionerMetadata,
  recordingAdapter,
  setupArtifact,
  throwingSecretRuntime,
  writePlanArtifact,
} from "./kubernetes.opentofu-apply.helpers";

async function tempDir(t: any): Promise<string> {
  const tmp = await fsp.mkdtemp(path.join(process.cwd(), ".opentofu-apply-guard-"));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));
  return tmp;
}

test("runOpenTofuReviewedApply rejects mismatched stack config fingerprint", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "stack-config-mismatch.json");
  await writePlanArtifact({
    artifactPath,
    stackConfigFingerprint: "sha256:recorded-stack-config",
  });
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: "sha256:admitted-stack-config",
  };
  const { adapter, calls } = recordingAdapter();
  const secrets = fakeSecretRuntime({});
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError &&
      error.reason === "stack_config_fingerprint_mismatch",
  );
  assert.equal(calls.length, 0, "adapter must not run when stack config fingerprint mismatches");
  assert.deepEqual(secrets.calls, [], "secret runtime must not be entered on rejection");
});

test("runOpenTofuReviewedApply rejects when provision credentials cannot be resolved", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "missing-credentials");
  const { adapter, calls } = recordingAdapter();
  const secrets = throwingSecretRuntime(
    "deployment secret runtime missing required provision credentials",
  );
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    /missing required provision credentials/,
  );
  assert.deepEqual(secrets.calls, ["provision"]);
  assert.equal(calls.length, 0, "apply adapter must not run when credentials are missing");
  const recordedArtifact = await fsp.readFile(provisionerPlan.artifactPath, "utf8");
  const parsed = JSON.parse(recordedArtifact);
  assert.equal(parsed.opentofu.planFingerprint, PLAN_FINGERPRINT);
});

test("runOpenTofuReviewedApply rejects empty provision credential sets", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "empty-credentials");
  const { adapter, calls } = recordingAdapter();
  const secrets = fakeSecretRuntime({});
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError &&
      error.reason === "provider_credentials_missing",
  );
  assert.deepEqual(secrets.calls, ["provision"]);
  assert.equal(calls.length, 0, "adapter must not run without provider credentials");
});

test("runOpenTofuReviewedApply rejects missing plan and backend fingerprints", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "missing-backend.json");
  await writePlanArtifact({ artifactPath, stateBackendIdentity: "" });
  const missingPlanFingerprint = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    stackConfigFingerprint: "sha256:stack-config",
  };
  const { adapter, calls } = recordingAdapter();
  const secrets = fakeSecretRuntime({ opentofu_provider_credentials: "vault" });
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan: missingPlanFingerprint,
      admittedProvisionerPlanFingerprint: missingPlanFingerprint.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError && error.reason === "plan_fingerprint_missing",
  );
  assert.equal(calls.length, 0);
  const withPlanFingerprint = {
    ...missingPlanFingerprint,
    planFingerprint: PLAN_FINGERPRINT,
  };
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan: withPlanFingerprint,
      admittedProvisionerPlanFingerprint: withPlanFingerprint.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError &&
      error.reason === "recorded_state_backend_identity_missing",
  );
});

test("runOpenTofuReviewedApply rejects empty stack identity before apply", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "missing-stack-identity.json");
  await writePlanArtifact({ artifactPath, stackIdentity: "" });
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
  const { adapter, calls } = recordingAdapter();
  const secrets = fakeSecretRuntime({ opentofu_provider_credentials: "vault" });
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata({ stackIdentity: "" }),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError && error.reason === "stack_identity_missing",
  );
  assert.equal(calls.length, 0, "adapter must not run without workspace identity");
  assert.deepEqual(secrets.calls, [], "secret runtime must not run before identity checks pass");
});

test("maybeRunOpenTofuReviewedApply fails closed when adapter construction fails", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "adapter-factory-failure");
  await assert.rejects(
    maybeRunOpenTofuReviewedApply({
      deployment: {
        provisioner: provisionerMetadata(),
      } as any,
      admittedContext: {
        policyEvaluation: {
          binding: { provisionerPlanFingerprint: provisionerPlan.fingerprint },
        },
        targetEnvironment: { lockScope: "kubernetes:prod" },
      } as any,
      provisionerPlan,
      hooks: {
        adapterFactory() {
          throw new Error("production opentofu adapter construction failed");
        },
        secretRuntimeFactory: () => {
          throw new Error("secret runtime must not be constructed after adapter failure");
        },
      },
    }),
    /adapter construction failed/,
  );
});

test("production OpenTofu adapter records command outcome without leaking ambient secret env", async (t) => {
  const tmp = await tempDir(t);
  const logPath = path.join(tmp, "fake-tofu.log");
  const binPath = path.join(tmp, "tofu");
  await fsp.writeFile(
    binPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf \'%s\\n\' "$PWD|$*|${opentofu_provider_credentials:-missing}|${BNX_DEPLOYMENT_TOKEN:-scrubbed}" > "$BNX_FAKE_OPENTOFU_LOG"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(binPath, 0o755);
  const previousLog = process.env.BNX_FAKE_OPENTOFU_LOG;
  const previousToken = process.env.BNX_DEPLOYMENT_TOKEN;
  process.env.BNX_FAKE_OPENTOFU_LOG = logPath;
  process.env.BNX_DEPLOYMENT_TOKEN = "ambient-secret-token";
  try {
    const adapter = createProductionOpenTofuApplyAdapter({ binary: binPath });
    const result = await adapter.apply({
      planArtifactPath: path.join(tmp, "admitted-plan.json"),
      applyPlanPath: path.join(tmp, "plan.tfplan"),
      stackDirectory: tmp,
      stateBackendIdentity: "s3://state-prod/foundation",
      credentialEnvNames: ["opentofu_provider_credentials"],
      credentialEnv: { opentofu_provider_credentials: "vault-value" },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.command.binary, binPath);
    const log = await fsp.readFile(logPath, "utf8");
    assert.match(log, /vault-value/);
    assert.match(log, /scrubbed/);
    assert.doesNotMatch(log, /ambient-secret-token/);
  } finally {
    if (previousLog === undefined) delete process.env.BNX_FAKE_OPENTOFU_LOG;
    else process.env.BNX_FAKE_OPENTOFU_LOG = previousLog;
    if (previousToken === undefined) delete process.env.BNX_DEPLOYMENT_TOKEN;
    else process.env.BNX_DEPLOYMENT_TOKEN = previousToken;
  }
});
