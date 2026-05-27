#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilityDeclaration } from "../../deployments/cloud-control-setup-contract";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES,
  runCloudProviderCapabilityHook,
} from "../../deployments/cloud-control-provider-capability-hooks";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-setup-validate";

test("provider-capability hook dispatch binds every phase to the concrete declaration", async () => {
  for (const phase of CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES) {
    const hook = await hookEvidence("aws-ec2-control-plane-host", phase);
    assert.equal(hook.phase, phase);
    assert.equal(hook.capabilityId, "aws-ec2-control-plane-host");
    assert.equal(hook.targetIdentity, hook.declaration.targetIdentity);
    assert.equal(hook.credentialSource, hook.declaration.credentialSource);
    assert.equal(hook.lockScope, hook.declaration.lockScope);
    assert.equal(hook.replaySemantics, hook.declaration.replaySemantics);
    assert.deepEqual(hook.auditEvidence, hook.declaration.auditEvidence);
    assert.ok(hook.output.summary);
    assert.doesNotMatch(JSON.stringify(hook.output), /token=|secret-value|password=/i);
  }
});

test("provider-capability hook dispatch rejects invalid contract bindings", async () => {
  const capability = capabilityDeclaration("aws-ec2-control-plane-host");
  await assert.rejects(
    hookEvidence("missing-capability", "preview"),
    /unknown provider-capability/,
  );
  await assert.rejects(
    hookEvidence(capability.id, "destroy" as any),
    /unsupported provider-capability hook phase/,
  );
  await assert.rejects(
    runCloudProviderCapabilityHook({
      capabilityId: capability.id,
      phase: "preview",
      deploymentLabel: "//deployments:staging",
      targetIdentity: "aws:wrong-target",
    }),
    /target identity does not match declaration/,
  );
  for (const declaration of badDeclarations(capability)) {
    await assert.rejects(
      runCloudProviderCapabilityHook({
        capabilityId: capability.id,
        phase: "preview",
        deploymentLabel: "//deployments:staging",
        declaration,
      }),
      /provider-capability hook rejected/,
    );
  }
});

test("provider-capability hook output is redacted before evidence persistence", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "cloudflare-edge",
    phase: "preview",
    deploymentLabel: "//deployments:staging",
  });
  assert.equal(hook.output.redacted, true);
  assert.equal(hook.output.classification, "redact_before_display");
});

test("hook evidence can satisfy readiness and cutover only for the selected matching capability", async () => {
  const hook = await hookEvidence("aws-ec2-control-plane-host", "evidence");
  assert.deepEqual(
    validateProviderCapabilityEvidence([hook.declaration], {
      [hook.capabilityId]: hook,
    }),
    [],
  );
  assert.match(
    validateProviderCapabilityEvidence([hook.declaration], {
      "aws-s3-artifact-store": hook,
    }).join("\n"),
    /protected\/shared readiness requires hook evidence/,
  );
  const cutoverHook = await hookEvidence("aws-ec2-control-plane-host", "smoke");
  assert.deepEqual(
    cutoverErrors({ [cutoverHook.capabilityId]: cutoverHook }, [cutoverHook.capabilityId]),
    [],
  );
  const wrongHook = await hookEvidence("aws-s3-artifact-store", "smoke");
  assert.match(
    cutoverErrors({ [cutoverHook.capabilityId]: wrongHook }, [cutoverHook.capabilityId]).join("\n"),
    /unrelated capability aws-s3-artifact-store/,
  );
});

test("wrong hook phases cannot satisfy readiness or cutover semantics", async () => {
  for (const phase of ["preview", "apply", "rollback"] as const) {
    const hook = await hookEvidence("aws-ec2-control-plane-host", phase);
    assert.match(
      validateProviderCapabilityEvidence([hook.declaration], { [hook.capabilityId]: hook }).join(
        "\n",
      ),
      /provider-capability evidence has wrong hook phase/,
    );
  }
  const evidenceHook = await hookEvidence("aws-ec2-control-plane-host", "evidence");
  assert.match(
    cutoverErrors({ [evidenceHook.capabilityId]: evidenceHook }, [evidenceHook.capabilityId]).join(
      "\n",
    ),
    /provider-capability evidence has wrong hook phase/,
  );
});

test("cutover rejects hand-built static capability evidence", () => {
  const declaration = capabilityDeclaration("aws-ec2-control-plane-host");
  const staticEvidence = {
    capabilityId: declaration.id,
    declaration,
    auditEvidence: [...declaration.auditEvidence],
    auditIdentity: "operator-1",
    rollbackProcedure: true,
    smokeEvidence: true,
  };
  assert.match(
    cutoverErrors({ [declaration.id]: staticEvidence }, [declaration.id]).join("\n"),
    /provider-capability evidence must be generated by executable hook/,
  );
});

test("readiness and cutover reject unsafe hand-written hook-shaped evidence", async () => {
  const hook = await hookEvidence("aws-ec2-control-plane-host", "evidence");
  const unsafe = {
    ...hook,
    output: {
      classification: "display_safe",
      redacted: false,
      summary: "token=secret-value",
      fingerprint: "sha256:unsafe",
    },
  };
  assert.match(
    validateProviderCapabilityEvidence([hook.declaration], { [hook.capabilityId]: unsafe }).join(
      "\n",
    ),
    /hook output must be redacted before evidence use.*unsafe secret-looking content/s,
  );
  const cutoverHook = await hookEvidence("aws-ec2-control-plane-host", "smoke");
  const unsafeCutover = { ...unsafe, phase: "smoke", smokeEvidence: true };
  assert.match(
    cutoverErrors({ [cutoverHook.capabilityId]: unsafeCutover }, [cutoverHook.capabilityId]).join(
      "\n",
    ),
    /hook output must be redacted before evidence use.*unsafe secret-looking content/s,
  );
});

test("readiness and cutover reject unsafe extra hook evidence fields", async () => {
  const readinessHook = await hookEvidence("aws-ec2-control-plane-host", "evidence");
  const unsafeReadiness = {
    ...readinessHook,
    metadata: { apiKey: "redacted" },
  };
  assert.match(
    validateProviderCapabilityEvidence([readinessHook.declaration], {
      [readinessHook.capabilityId]: unsafeReadiness,
    }).join("\n"),
    /hook evidence contains unsafe secret-looking content at \$\.metadata\.apiKey/,
  );
  const cutoverHook = await hookEvidence("aws-ec2-control-plane-host", "smoke");
  const unsafeCutover = {
    ...cutoverHook,
    metadata: { clientSecret: "redacted" },
  };
  assert.match(
    cutoverErrors({ [cutoverHook.capabilityId]: unsafeCutover }, [cutoverHook.capabilityId]).join(
      "\n",
    ),
    /hook evidence contains unsafe secret-looking content at \$\.metadata\.clientSecret/,
  );
});

test("static-only and placeholder declarations cannot satisfy protected readiness", () => {
  const capability = capabilityDeclaration("aws-ec2-control-plane-host");
  const errors = validateProviderCapabilityEvidence(
    [
      {
        ...capability,
        targetIdentity: "placeholder provider target",
        iac: { ...capability.iac, applyCommand: "terraform apply" },
      },
    ],
    { [capability.id]: capability.auditEvidence },
  ).join("\n");
  assert.match(errors, /declaration must match the concrete capability catalog/);
  assert.match(errors, /protected\/shared readiness requires hook evidence/);
});

test("live-gated selected provider capability preview and smoke dispatch hooks", async (t) => {
  if (process.env.VBR_CLOUD_PROVIDER_CAPABILITY_LIVE !== "1") {
    t.skip("set VBR_CLOUD_PROVIDER_CAPABILITY_LIVE=1 for live provider preview/smoke hooks");
    return;
  }
  const deploymentLabel = requiredEnv("VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_DEPLOYMENT_LABEL");
  assert.doesNotMatch(deploymentLabel, /^(prod|production)$/i);
  for (const capabilityId of liveCapabilityIds()) {
    for (const phase of ["preview", "smoke"] as const) {
      const hook = await runCloudProviderCapabilityHook({ capabilityId, phase, deploymentLabel });
      assert.equal(hook.capabilityId, capabilityId);
      assert.equal(hook.phase, phase);
    }
  }
});

function hookEvidence(capabilityId: string, phase: any) {
  return runCloudProviderCapabilityHook({
    capabilityId,
    phase,
    deploymentLabel: "//deployments:staging",
  });
}

function badDeclarations(capability: ReturnType<typeof capabilityDeclaration>) {
  return [
    { ...capability, credentialSource: "" },
    { ...capability, lockScope: "" },
    { ...capability, auditEvidence: [] },
  ];
}

function cutoverErrors(
  providerCapabilities: Record<string, unknown>,
  selectedCapabilities: string[],
) {
  return validateCutoverProviderCapabilities({ providerCapabilities } as any, selectedCapabilities);
}

function liveCapabilityIds(): string[] {
  return (process.env.VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_IDS || "aws-ec2-control-plane-host")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required when live provider capability hooks are enabled`);
  return value;
}
