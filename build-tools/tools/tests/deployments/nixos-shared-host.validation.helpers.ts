#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../../lib/graph.ts";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";

export function staticWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:pwa"],
  };
}

export function ssrWebappComponent(label: string): GraphNode {
  return {
    name: label,
    labels: ["kind:app", "webapp:ssr", "framework:vite"],
  };
}

export function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/demoapp-dev:deploy",
    provider: "nixos-shared-host",
    component: "//projects/apps/demoapp:app",
    component_kind: "static-webapp",
    publisher: "nixos-shared-host-static-webapp",
    provisioner: "nixos-shared-host-manifest",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "dev",
    admission_policy: "//projects/deployments/pleomino-shared:dev_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    app_name: "demoapp",
    container_port: 3000,
    health_path: "/healthz",
    target_group: "",
    ...overrides,
  };
}

export function policyNodes(): GraphNode[] {
  return [
    nixosSharedHostLaneGovernanceNodeFixture(),
    nixosSharedHostLanePolicyNodeFixture(),
    nixosSharedHostAdmissionPolicyNodeFixture(),
  ];
}
