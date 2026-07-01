#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeploymentResourceEnvelopes,
  type DeploymentResourceEnvelopeSet,
} from "../../deployments/resource-graph-envelope";
import { createDeploymentResourceGraphDocuments } from "../../deployments/resource-graph-export";
import type {
  DeploymentResourceInventory,
  DeploymentResourceInventoryEntry,
} from "../../deployments/resource-graph-types";

test("export documents snapshot resource nodes and required edge categories", () => {
  const documents = documentsFor(fullInventory());
  assert.deepEqual(documents.nodes.nodes.map((node) => `${node.kind}:${node.name}`).sort(), [
    "AdmissionPolicy:admission",
    "ArtifactInput:deploy:artifact-input",
    "Component:deploy:web",
    "ControlPlaneProfile:mini",
    "ControlPlaneSelection:deploy:mini",
    "Deployment:deploy",
    "DeploymentContext:app-prod",
    "DeploymentFamily:family",
    "DeploymentTargetException:exception",
    "EnvironmentStage:deploy:prod",
    "LaneGovernancePolicy:governance",
    "LanePolicy:lane",
    "ProviderTarget:provider",
    "Provisioner:deploy:provisioner",
    "ReleaseAction:release",
    "RuntimeConfigRequirement:deploy:runtime-config:publish:api",
    "SecretRequirement:deploy:secret:publish:token",
    "ServiceClientProfile:mini:service-client",
    "SourceMetadata://projects/deployments/demo:deploy",
  ]);
  assert.deepEqual([...new Set(documents.edges.edges.map((edge) => edge.kind))].sort(), [
    "artifact_input",
    "component",
    "control_plane",
    "deployment_context",
    "environment_stage",
    "family",
    "owner",
    "policy",
    "provider_target",
    "provisioner",
    "release_action",
    "requirement",
    "source",
    "target_exception",
  ]);
  assert.match(edgeSummary(documents), /Deployment->Component:component/);
  assert.match(edgeSummary(documents), /Deployment->ProviderTarget:provider_target/);
  assert.match(edgeSummary(documents), /Deployment->SecretRequirement:requirement/);
  assert.match(edgeSummary(documents), /Deployment->SourceMetadata:source/);
});

test("source metadata covers remote, local, and sibling checkout paths", () => {
  const paths = ["/nix/store/source-a", "..", "../viberoots"];
  const documents = paths.map((sourcePath) => documentsFor(fullInventory(sourcePath)));
  const sourceNames = documents.map(
    (document) => document.nodes.nodes.find((node) => node.kind === "SourceMetadata")?.name,
  );
  assert.deepEqual(sourceNames, [
    "//projects/deployments/demo:deploy",
    "//projects/deployments/demo:deploy",
    "//projects/deployments/demo:deploy",
  ]);
  assert.equal(
    new Set(documents.map((document) => deploymentUid(document.envelopes))).size,
    1,
    "repo-owned deployment uid must ignore checkout source paths",
  );
  for (const document of documents) {
    assert.ok(document.edges.edges.some((edge) => edge.kind === "source"));
  }
});

function documentsFor(inventory: DeploymentResourceInventory) {
  const envelopes = createDeploymentResourceEnvelopes(inventory);
  assert.deepEqual(envelopes.errors, []);
  return createDeploymentResourceGraphDocuments(envelopes);
}

function fullInventory(sourcePath = "/nix/store/source-a"): DeploymentResourceInventory {
  const e = (kind: DeploymentResourceInventoryEntry["kind"], id: string, refs: string[] = []) =>
    entry(kind, id, refs, {}, "//projects/deployments/demo:deploy", sourcePath);
  return inventory([
    deployment(
      [
        "family",
        "deploy:web",
        "provider",
        "deploy:prod",
        "lane",
        "governance",
        "admission",
        "deploy:secret:publish:token",
        "deploy:runtime-config:publish:api",
        "app-prod",
        "mini",
        "deploy:mini",
        "mini:service-client",
        "exception",
        "deploy:provisioner",
        "release",
        "deploy:artifact-input",
      ],
      { sourcePath },
    ),
    e("DeploymentFamily", "family"),
    e("Component", "deploy:web"),
    e("ProviderTarget", "provider"),
    e("EnvironmentStage", "deploy:prod"),
    e("LanePolicy", "lane", ["governance"]),
    e("LaneGovernancePolicy", "governance"),
    e("AdmissionPolicy", "admission"),
    e("SecretRequirement", "deploy:secret:publish:token"),
    e("RuntimeConfigRequirement", "deploy:runtime-config:publish:api"),
    e("DeploymentContext", "app-prod"),
    e("ControlPlaneProfile", "mini"),
    e("ControlPlaneSelection", "deploy:mini", ["deploy", "mini", "app-prod"]),
    e("ServiceClientProfile", "mini:service-client", ["deploy:mini"]),
    e("DeploymentTargetException", "exception", ["deploy"]),
    e("Provisioner", "deploy:provisioner", ["deploy", "provider"]),
    e("ReleaseAction", "release", ["deploy"]),
    e("ArtifactInput", "deploy:artifact-input", ["deploy", "deploy:web"]),
  ]);
}

function deployment(
  refs: string[],
  facts: Record<string, unknown> & { sourcePath?: string } = {},
): DeploymentResourceInventoryEntry {
  return entry(
    "Deployment",
    "deploy",
    refs,
    {
      providerTargetIdentity: facts.providerTargetIdentity || "provider",
      lanePolicyRef: facts.lanePolicyRef || "lane",
      admissionPolicyRef: facts.admissionPolicyRef || "admission",
      secretRequirementRefs: facts.secretRequirementRefs || [],
      runtimeConfigRequirementRefs: facts.runtimeConfigRequirementRefs || [],
    },
    "//projects/deployments/demo:deploy",
    facts.sourcePath,
  );
}

function entry(
  kind: DeploymentResourceInventoryEntry["kind"],
  id: string,
  refs: string[] = [],
  facts: Record<string, unknown> = {},
  label = "//projects/deployments/demo:deploy",
  sourcePath?: string,
): DeploymentResourceInventoryEntry {
  return {
    kind,
    id,
    authority: "reviewed_intent",
    source: { class: "buck", label, ...(sourcePath ? { path: sourcePath } : {}) },
    refs,
    facts,
  };
}

function inventory(resources: DeploymentResourceInventoryEntry[]): DeploymentResourceInventory {
  return {
    taxonomyVersion: "deployment-resource-taxonomy@1",
    resources,
    errors: [],
    graphRead: { providerIndexAvailable: false, nodeLockIndexAvailable: false },
    workspace: {
      supportedDeploymentQueryRoots: [],
      projectConfig: {
        sharedPath: "projects/config/shared.json",
        localPath: "projects/config/local.json",
        localPresent: false,
        disallowLocalOverrides: false,
        redactedOverrides: [],
      },
    },
  };
}

function edgeSummary(documents: ReturnType<typeof createDeploymentResourceGraphDocuments>) {
  return documents.edges.edges
    .map((edge) => `${edge.fromKind}->${edge.toKind}:${edge.kind}`)
    .sort()
    .join("\n");
}

function deploymentUid(envelopes: DeploymentResourceEnvelopeSet): string {
  return envelopes.envelopes.find((envelope) => envelope.kind === "Deployment")!.metadata.uid;
}
