#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import {
  REVIEWED_NON_STATIC_COMPONENT_KINDS,
  REVIEWED_PROVIDER_CAPABILITIES,
  REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
  REVIEWED_PROVIDER_IDS,
  providerAllowsRoutineProtectedSharedReleaseActionType,
  providerCapabilityFor,
  providerDeclaresReleaseActionType,
  rolloutPolicyOmissionInPolicy,
} from "../../deployments/deployment-provider-capabilities.ts";
import {
  DEPLOYMENTS_DESIGN_DOC_PATH,
  assertDeploymentsDesignDocParity,
  renderDeploymentsDesignDoc,
} from "../../deployments/design-summary-doc.ts";
import {
  PROVIDER_CAPABILITIES_DOC_PATH,
  assertProviderCapabilitiesDocParity,
  renderProviderCapabilitiesDoc,
} from "../../deployments/provider-capabilities/doc.ts";
import { assertDeployTextUsesReviewedSelector } from "../../deployments/provider-capabilities/front-door-contract.ts";
import { validateProviderCapabilityRegistry } from "../../deployments/provider-capabilities/validate.ts";

test("reviewed provider registry is complete and deterministic", () => {
  assert.deepEqual(REVIEWED_PROVIDER_IDS, [
    "nixos-shared-host",
    "app-store-connect",
    "google-play",
    "cloudflare-pages",
    "s3-static",
    "kubernetes",
  ]);
  assert.equal(REVIEWED_PROVIDER_CAPABILITIES.length, REVIEWED_PROVIDER_IDS.length);
  assert.deepEqual(
    REVIEWED_PROVIDER_CAPABILITIES.map((capability) => capability.provider),
    [...REVIEWED_PROVIDER_IDS],
  );
  validateProviderCapabilityRegistry({ ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER });
});

test("checked-in provider capabilities doc stays in exact rendered parity with the registry", async () => {
  const current = await fsp.readFile(PROVIDER_CAPABILITIES_DOC_PATH, "utf8");
  assertProviderCapabilitiesDocParity(current);
  assert.equal(renderProviderCapabilitiesDoc(current), current);
  assert.equal(renderProviderCapabilitiesDoc(current), renderProviderCapabilitiesDoc(current));
  assert.doesNotThrow(() =>
    assertDeployTextUsesReviewedSelector("provider capabilities doc", current),
  );
  assert.match(
    current,
    /deploy --deployment <label> --preview --source-run-id <deploy-run-id>/,
    "provider capabilities doc must describe reviewed operator examples with --deployment <label>",
  );
});

test("deployments design reviewed-provider summaries stay in exact rendered parity with the registry", async () => {
  const current = await fsp.readFile(DEPLOYMENTS_DESIGN_DOC_PATH, "utf8");
  assertDeploymentsDesignDocParity(current);
  assert.equal(renderDeploymentsDesignDoc(current), current);
  assert.equal(renderDeploymentsDesignDoc(current), renderDeploymentsDesignDoc(current));
});

test("legacy lookup helpers preserve the reviewed runtime contract", () => {
  assert.equal(providerCapabilityFor("app-store-connect")?.defaultRolloutMode, "all_at_once");
  assert.equal(providerCapabilityFor("google-play")?.defaultRolloutMode, "all_at_once");
  assert.equal(providerCapabilityFor("nixos-shared-host")?.defaultRolloutMode, "all_at_once");
  assert.equal(providerCapabilityFor("cloudflare-pages")?.defaultRolloutMode, "all_at_once");
  assert.equal(providerCapabilityFor("s3-static")?.defaultRolloutMode, "all_at_once");
  assert.equal(providerCapabilityFor("kubernetes")?.defaultRolloutMode, "all_at_once");
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "app-store-connect", componentCount: 1 }),
    true,
  );
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "google-play", componentCount: 1 }), true);
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "nixos-shared-host", componentCount: 1 }),
    true,
  );
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "nixos-shared-host", componentCount: 2 }),
    false,
  );
  assert.equal(
    rolloutPolicyOmissionInPolicy({ provider: "cloudflare-pages", componentCount: 1 }),
    true,
  );
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "s3-static", componentCount: 1 }), true);
  assert.equal(rolloutPolicyOmissionInPolicy({ provider: "kubernetes", componentCount: 1 }), true);
  assert.equal(providerDeclaresReleaseActionType("nixos-shared-host", "cache_warmup"), true);
  assert.equal(
    providerDeclaresReleaseActionType("nixos-shared-host", "post_publish_verification"),
    true,
  );
  assert.equal(providerDeclaresReleaseActionType("nixos-shared-host", "schema_migration"), true);
  assert.equal(
    providerAllowsRoutineProtectedSharedReleaseActionType("nixos-shared-host", "schema_migration"),
    false,
  );
  assert.equal(providerDeclaresReleaseActionType("cloudflare-pages", "cache_warmup"), false);
  assert.equal(providerDeclaresReleaseActionType("s3-static", "cache_warmup"), false);
  assert.equal(providerDeclaresReleaseActionType("kubernetes", "cache_warmup"), false);
  const nixos = providerCapabilityFor("nixos-shared-host");
  assert.deepEqual(nixos?.supportedComponentKinds, ["static-webapp", "ssr-webapp"]);
  assert.deepEqual(nixos?.multiComponentKinds, ["static-webapp"]);
  const kubernetes = providerCapabilityFor("kubernetes");
  assert.deepEqual(kubernetes?.supportedComponentKinds, ["service", "third-party-service"]);
  assert.deepEqual(kubernetes?.multiComponentKinds, ["service", "third-party-service"]);
  assert.deepEqual(kubernetes?.supportedRolloutModes, ["all_at_once", "ordered_best_effort"]);
  const capability = providerCapabilityFor("app-store-connect");
  assert.deepEqual(capability?.supportedComponentKinds, ["mobile-app"]);
  assert.deepEqual(capability?.multiComponentKinds, []);
  assert.deepEqual(capability?.supportedRolloutModes, ["all_at_once", "store_staged"]);
});

test("the reviewed non-static component kinds are available for later provider slices", () => {
  assert.deepEqual(REVIEWED_NON_STATIC_COMPONENT_KINDS, [
    "ssr-webapp",
    "mobile-app",
    "service",
    "third-party-service",
  ]);
});

test("validation fails closed when a provider entry omits required reviewed capability data", () => {
  const badRegistry = {
    ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
    "cloudflare-pages": {
      ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["cloudflare-pages"],
      previewSupport: {
        ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["cloudflare-pages"].previewSupport,
        support: [],
      },
    },
  };
  assert.throws(
    () => validateProviderCapabilityRegistry(badRegistry),
    /cloudflare-pages: previewSupport\.support must not be empty/,
  );
});

test("validation fails closed when provider operator examples drift from the reviewed front door", () => {
  const badRegistry = {
    ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER,
    "cloudflare-pages": {
      ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["cloudflare-pages"],
      previewSupport: {
        ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER["cloudflare-pages"].previewSupport,
        support: [
          ...REVIEWED_PROVIDER_CAPABILITIES_BY_PROVIDER[
            "cloudflare-pages"
          ].previewSupport.support.slice(0, 1),
          {
            text: "the current built-in operator contract uses `deploy <deployment> --preview --source-run-id <deploy-run-id>`",
          },
        ],
      },
    },
  };
  assert.throws(
    () => validateProviderCapabilityRegistry(badRegistry),
    /cloudflare-pages: capability\.previewSupport\.support\[1\]\.text deploy command must use the reviewed --deployment <label> selector/,
  );
});

test("provider capabilities doc operator examples fail closed on stale deploy selectors", async () => {
  const current = await fsp.readFile(PROVIDER_CAPABILITIES_DOC_PATH, "utf8");
  const stale = current.replace(
    "`deploy --deployment <label> --preview --source-run-id <deploy-run-id>`",
    "`deploy <deployment> --preview --source-run-id <deploy-run-id>`",
  );
  assert.throws(
    () => assertDeployTextUsesReviewedSelector("provider capabilities doc", stale),
    /provider capabilities doc: text deploy command must use the reviewed --deployment <label> selector/,
  );
});

test("doc parity fails closed when the rendered provider entries drift", async () => {
  const current = await fsp.readFile(PROVIDER_CAPABILITIES_DOC_PATH, "utf8");
  const stale = current.replace(
    "## Capability Entry: `nixos-shared-host`",
    "## Capability Entry: `nixos-shared-host-drift`",
  );
  assert.throws(
    () => assertProviderCapabilitiesDocParity(stale),
    /provider capabilities doc is stale/,
  );
});

test("design-summary parity fails closed when the reviewed provider summaries drift", async () => {
  const current = await fsp.readFile(DEPLOYMENTS_DESIGN_DOC_PATH, "utf8");
  const stale = current.replace(
    "reviewed only with explicit preview metadata",
    "reviewed only with implicit preview metadata",
  );
  assert.throws(() => assertDeploymentsDesignDocParity(stale), /deployments design doc is stale/);
});
