export const DEPLOYMENT_GOLDENS: Record<string, Record<string, string>> = {
  "demo-shared": {
    "README.md": `# demo Shared Deployment Lane

This package owns reviewed lane governance and admission policy for the \`demo\` deployment family.

Fill in source-ref policies, trusted check reporters, and production approval groups before using the
generated policies for protected or shared environments.
`,
    TARGETS: `load(
    "@viberoots//build-tools/deployments:defs.bzl",
    "deployment_admission_policy",
    "deployment_lane_governance",
    "deployment_lane_policy",
)

deployment_lane_governance(
    name = "lane_governance",
    scm_backend = "github",
    repository = "example/platform",
    source_ref_policies = [
        {"stage": "dev", "allowed_refs": "main", "required_checks": "deploy/admission"},
        {"stage": "staging", "allowed_refs": "main,refs/tags/release/*", "required_checks": "deploy/admission"},
        {"stage": "prod", "allowed_refs": "refs/tags/release/*", "required_checks": "deploy/admission"},
    ],
    trusted_reporter_identities = ["repository-role:admin"],
    required_approval_boundaries = [
        {"stage": "prod", "required_approvals": "release-owner"},
    ],
    visibility = ["PUBLIC"],
)

deployment_lane_policy(
    name = "lane",
    defaults = "//projects/deployments:defaults",
    stages = ["dev", "staging", "prod"],
    source_ref_policy = {
        "dev": "main",
        "staging": "main",
        "prod": "refs/tags/release/*",
    },
    allowed_promotion_edges = ["dev->staging", "staging->prod"],
    artifact_reuse_mode = "same_artifact",
    governance_policy = ":lane_governance",
    default_client_profile = "mini",
    visibility = ["PUBLIC"],
)

deployment_admission_policy(
    name = "dev_release",
    allowed_refs = ["main"],
    required_checks = ["deploy/admission"],
    artifact_attestation_mode = "recorded_exact_artifact",
    visibility = ["PUBLIC"],
)

deployment_admission_policy(
    name = "staging_release",
    allowed_refs = ["main", "refs/tags/release/*"],
    required_checks = ["deploy/admission"],
    artifact_attestation_mode = "recorded_exact_artifact",
    visibility = ["PUBLIC"],
)

deployment_admission_policy(
    name = "prod_release",
    allowed_refs = ["refs/tags/release/*"],
    required_checks = ["deploy/admission"],
    required_approvals = ["release-owner"],
    artifact_attestation_mode = "recorded_exact_artifact",
    visibility = ["PUBLIC"],
)
`,
  },
  "demo-vercel": {
    "README.md": `# demo-vercel Vercel Deployment

This package publishes an admitted prebuilt Next.js artifact to Vercel.

Replace placeholder contract IDs with reviewed secret and runtime config contracts before promoting
the deployment outside local fixtures.
`,
    TARGETS: `load("@viberoots//build-tools/deployments:defs.bzl", "vercel_next_webapp_deployment")

vercel_next_webapp_deployment(
    name = "deploy",
    component = "//projects/apps/console:vercel_artifact",
    team = "acme",
    project = "console",
    environment = "preview",
    canonical_url = "https://demo-vercel.example.invalid",
    lane_policy = "//projects/deployments/demo-shared:lane",
    environment_stage = "dev",
    admission_policy = "//projects/deployments/demo-shared:dev_release",
    secret_requirements = [
        {
            "name": "vercel-api-token",
            "step": "publish",
            "contract_id": "secret://deployments/demo-vercel/vercel_api_token",
            "required": "true",
        },
    ],
    runtime_config_requirements = [
        {
            "name": "public-console-url",
            "step": "publish",
            "contract_id": "runtime://deployments/demo-vercel/public_url",
            "required": "true",
        },
    ],
    smoke = {
        "runner": "http",
        "url": "https://demo-vercel.example.invalid",
        "expected_status": "200",
    },
)
`,
    "vercel-prebuilt.jsonc": `{
  "schemaVersion": "vercel-prebuilt-publisher@1",
  "team": "acme",
  "project": "console",
  "environment": "preview",
  "artifact": "//projects/apps/console:vercel_artifact",
  "canonicalUrl": "https://demo-vercel.example.invalid"
}
`,
  },
  "demo-api": {
    "README.md": `# demo-api Service Deployment

This package deploys a reviewed service artifact through the Kubernetes provider.

Keep \`helm/values.yaml\` as provider config only. Artifact identity, secret requirements, runtime
config requirements, and smoke posture remain authoritative in \`TARGETS\`.
`,
    TARGETS: `load("@viberoots//build-tools/deployments:defs.bzl", "kubernetes_service_deployment")

kubernetes_service_deployment(
    name = "deploy",
    component = "//projects/apps/api:service_artifact",
    cluster = "dev-cluster",
    namespace = "demo-api",
    release = "demo-api",
    service_kind = "web",
    health_path = "/healthz",
    lane_policy = "//projects/deployments/demo-shared:lane",
    environment_stage = "dev",
    admission_policy = "//projects/deployments/demo-shared:dev_release",
    secret_requirements = [
        {
            "name": "container-runtime-token",
            "step": "publish",
            "contract_id": "secret://deployments/demo-api/container_runtime_token",
            "required": "true",
        },
    ],
    runtime_config_requirements = [
        {
            "name": "service-public-url",
            "step": "smoke",
            "contract_id": "runtime://deployments/demo-api/public_url",
            "required": "true",
        },
    ],
    smoke = {
        "runner": "service-health",
        "path": "/healthz",
    },
)
`,
    "helm/values.yaml": `image:
  digest: "sha256:replace-with-admitted-service-artifact"
service:
  kind: "web"
  healthPath: "/healthz"
ingress:
  mode: "public"
`,
  },
  "demo-foundation": {
    "README.md": `# demo-foundation OpenTofu Foundation Deployment

This package declares an \`opentofu-stack\` provisioner. Admission evidence must bind the reviewed
plan fingerprint before protected or shared mutation proceeds.
`,
    TARGETS: `load("@viberoots//build-tools/deployments:defs.bzl", "kubernetes_service_deployment")

kubernetes_service_deployment(
    name = "deploy",
    component = "//projects/apps/foundation:service_artifact",
    cluster = "dev-cluster",
    namespace = "demo-foundation",
    release = "demo-foundation",
    service_kind = "worker",
    provisioner = "opentofu-stack",
    provisioner_config = "opentofu/stack.json",
    lane_policy = "//projects/deployments/demo-shared:lane",
    environment_stage = "dev",
    admission_policy = "//projects/deployments/demo-shared:dev_release",
    provider_target = {
        "stack_identity": "foundation/demo-foundation",
        "state_backend_identity": "s3://replace-me/demo-foundation",
    },
    secret_requirements = [
        {
            "name": "opentofu-provider-credentials",
            "step": "provision",
            "contract_id": "secret://deployments/demo-foundation/opentofu_provider",
            "required": "true",
        },
    ],
)
`,
    "opentofu/main.tf": `terraform {
  required_version = ">= 1.8.0"
}
`,
    "opentofu/plan.json": `{ "resource_changes": [] }\n`,
    "opentofu/plan.tfplan": `replace with saved plan from: tofu plan -out=plan.tfplan\n`,
    "opentofu/stack.json": `{
  "plan_json": "plan.json",
  "apply_plan": "plan.tfplan",
  "provider_lock": "providers.lock.hcl",
  "stack_identity": "foundation/demo-foundation",
  "state_backend_identity": "s3://replace-me/demo-foundation"
}
`,
  },
  "demo-attached": {
    "README.md": `# demo-attached OpenTofu Provisioner

This scaffold adds the package-local \`opentofu/\` layout expected by the reviewed \`opentofu-stack\`
provisioner.
`,
    "opentofu/main.tf": `terraform {
  required_version = ">= 1.8.0"
}
`,
    "opentofu/plan.json": `{ "resource_changes": [] }\n`,
    "opentofu/plan.tfplan": `replace with saved plan from: tofu plan -out=plan.tfplan\n`,
    "opentofu/stack.json": `{
  "plan_json": "plan.json",
  "apply_plan": "plan.tfplan",
  "provider_lock": "providers.lock.hcl",
  "stack_identity": "app/demo-attached",
  "state_backend_identity": "s3://replace-me/demo-attached"
}
`,
  },
};
