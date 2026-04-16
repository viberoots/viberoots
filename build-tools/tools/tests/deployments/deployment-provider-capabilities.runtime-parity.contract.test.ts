#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER } from "../../deployments/deployment-provider-capabilities.ts";
import { reviewedRuntimeContractFor } from "../../deployments/provider-capabilities/runtime-contract.ts";
import { assertReviewedRuntimeParity } from "../../deployments/provider-capabilities/runtime-parity.ts";
import { validateProviderCapabilityRegistry } from "../../deployments/provider-capabilities/validate.ts";

test("runtime parity guardrail fails closed when reviewed runtime posture is missing from the registry", () => {
  const badRegistry = {
    ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
    "s3-static": {
      ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["s3-static"],
      retryIdempotency: [
        {
          text: "exact-artifact retry is reviewed only when the prior attempt is clearly safe to rerun",
        },
      ],
      immutableReuseOperatorFlows: undefined,
    },
  };
  assert.throws(
    () => validateProviderCapabilityRegistry(badRegistry),
    /s3-static: retryIdempotency must describe reviewed runtime parity/,
  );
});

test("runtime parity guardrail fails closed when capability wording is stale but self-consistent", () => {
  const badRegistry = {
    ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
    kubernetes: {
      ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER.kubernetes,
      retryIdempotency: [
        {
          text: "shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`",
        },
        {
          text: "same-deployment `--publish-only` is reviewed only as promotion",
        },
        {
          text: "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical release target identity",
        },
      ],
      immutableReuseOperatorFlows: [
        {
          text: "reviewed protected/shared exact-artifact reuse slice:",
          children: [
            { text: "same-deployment rollback requires both `--publish-only` and `--rollback`" },
            {
              text: "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
            },
            {
              text: "retry and rollback may re-resolve ambient workspace state after control-plane replay",
            },
          ],
        },
      ],
    },
  };
  assert.throws(
    () => validateProviderCapabilityRegistry(badRegistry),
    /kubernetes: retryIdempotency must describe reviewed runtime parity: same-deployment `--publish-only` is reviewed as `retry`/,
  );
});

test("s3-static parity assertions derive expectations from the shared runtime contract", () => {
  const runtimeContract = reviewedRuntimeContractFor("s3-static");
  assert.doesNotThrow(() =>
    assertReviewedRuntimeParity({
      provider: "s3-static",
      capability: REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["s3-static"],
      runtimeContract,
    }),
  );
  assert.throws(
    () =>
      assertReviewedRuntimeParity({
        provider: "s3-static",
        capability: REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["s3-static"],
        runtimeContract: {
          ...runtimeContract,
          exactReuseSurface: "service-component-artifacts",
        },
      }),
    /s3-static: retryIdempotency must describe reviewed runtime parity: shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`/,
  );
});

test("kubernetes parity assertions derive expectations from the shared runtime contract", () => {
  const runtimeContract = reviewedRuntimeContractFor("kubernetes");
  assert.doesNotThrow(() =>
    assertReviewedRuntimeParity({
      provider: "kubernetes",
      capability: REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER.kubernetes,
      runtimeContract,
    }),
  );
  assert.throws(
    () =>
      assertReviewedRuntimeParity({
        provider: "kubernetes",
        capability: REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER.kubernetes,
        runtimeContract: {
          ...runtimeContract,
          immutableReuseGuarantee: "retained-artifact-unavailable-fails-closed",
        },
      }),
    /kubernetes: immutableReuseOperatorFlows must describe reviewed runtime parity: retry or rollback fails closed when the retained exact artifact is unavailable/,
  );
});
