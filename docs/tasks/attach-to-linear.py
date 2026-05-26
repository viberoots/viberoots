#!/usr/bin/env python3
"""
Attaches each task markdown file to its corresponding Linear issue.
Uses the Linear GraphQL API directly with LINEAR_API_KEY.
Flow per file: fileUpload mutation → PUT to GCS → attachmentCreate mutation.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API_KEY = os.environ.get("LINEAR_API_KEY", "")
if not API_KEY:
    sys.exit("ERROR: LINEAR_API_KEY not set")

GRAPHQL_URL = "https://api.linear.app/graphql"
TASKDIR = os.path.dirname(os.path.abspath(__file__))

# filename -> (size_bytes, linear_identifier, attachment_title)
FILES = [
    ("01-containerize-control-plane.md",        13951, "PROD-36", "Task spec: Containerize Control Plane + Move to Cloud"),
    ("02-infisical-secrets-provider.md",         10262, "PROD-33", "Task spec: Infisical Secrets Provider"),
    ("03-kubernetes-opentofu-deployment.md",     11161, "PROD-37", "Task spec: Simple Kubernetes / OpenTofu Deployment to Bundle Control Plane"),
    ("04-supabase-workos-auth-provider.md",      11066, "PROD-38", "Task spec: Supabase/WorkOS Auth Provider"),
    ("05-auth-provisioning-iac.md",               8878, "PROD-39", "Task spec: Auth Provisioning IaC"),
    ("06-cloudflare-container-deployment.md",     8438, "PROD-40", "Task spec: Container Deployment Provider"),
    ("07-vercel-build-target.md",                10930, "PROD-41", "Task spec: Vercel Build Target"),
    ("08-vercel-deployment-provider.md",         15896, "PROD-42", "Task spec: Vercel Deployment Provider"),
    ("09-backend-service-build-templates.md",    10510, "PROD-43", "Task spec: Backend Service Build Template(s)"),
    ("10-backend-service-deployment-template.md",11510, "PROD-44", "Task spec: Backend Service Deployment Template"),
    ("11-bob-monorepo-setup.md",                 10973, "PROD-55", "Task spec: Get Bob Set Up with viberoots-Based Monorepo"),
    ("12-bob-deployment-dry-run.md",             13367, "PROD-56", "Task spec: Dry Run Deployment Flow with Bob / Iterate"),
    ("13-supabase-db-deployment.md",             11590, "PROD-45", "Task spec: Supabase DB Deployment"),
    ("14-health-readiness-contract.md",           9212, "PROD-46", "Task spec: Unified Health/Readiness Contract for Services"),
    ("15-centralized-structured-logging.md",     12843, "PROD-48", "Task spec: Centralized Structured Logging"),
    ("16-unified-audit-logging.md",              13637, "PROD-49", "Task spec: Unified Audit Logging"),
    ("17-simple-monitoring.md",                  14672, "PROD-50", "Task spec: Simple Monitoring (Prometheus / OpenTelemetry / Tracing / Status Page)"),
    ("18-dead-letter-queue-strategy.md",         11854, "PROD-51", "Task spec: Common Dead-Letter Queue Strategy"),
    ("19-pr-preview-deployments.md",             10577, "PROD-52", "Task spec: PR/Preview Deployments"),
    ("20-control-plane-webapp.md",                9255, "PROD-54", "Task spec: Simple Control Plane Webapp"),
    ("21-rollout-strategy.md",                   12203, "PROD-57", "Task spec: Rollout Strategy (Blue/Green vs. Canary vs. Simple Replace)"),
    ("22-artifact-cache-retention.md",           11942, "PROD-58", "Task spec: Artifact Cache / Retention Tools and Policy"),
    ("23-local-stack-deployment.md",             12318, "PROD-47", "Task spec: Local Stack Deployment"),
    ("24-adr-process-conventions.md",             9332, "PROD-59", "Task spec: Simple ADR Process / Conventions"),
    ("25-document-simple-sdlc.md",                8764, "PROD-60", "Task spec: Document Simple SDLC"),
    ("26-multi-tenant-isolation-design.md",      16479, "PROD-61", "Task spec: Multi-Tenant Isolation Invariants / Design"),
    ("27-migration-versioning-conventions.md",   16582, "PROD-62", "Task spec: Migration/Versioning Conventions for Infra + DB"),
    ("28-forking-strategy.md",                   10052, "PROD-63", "Task spec: Decide Forking Strategy for unfairly / viberoots"),
    ("29-internal-pki-service-auth.md",          14458, "PROD-64", "Task spec: Internal PKI / Service Auth Strategy"),
    ("30-secret-rotation-policy.md",             14428, "PROD-65", "Task spec: Secret Rotation Policy & Workflows"),
    ("31-webhook-signature-verification.md",     10785, "PROD-66", "Task spec: Webhook Signature Verification Framework"),
    ("32-supply-chain-scanning.md",              13125, "PROD-68", "Task spec: Supply-Chain Scanning"),
    ("33-sbom-generation.md",                     9178, "PROD-67", "Task spec: SBOM Generation"),
    ("34-backup-restore-dr.md",                  13865, "PROD-69", "Task spec: Validated Backup/Restore/Disaster Recovery Procedures"),
    ("35-control-plane-mcp-surface.md",          10289, "PROD-53", "Task spec: Control Plane MCP Surface"),
    ("36-remote-execution-builds-tests.md",      12328, "PROD-70", "Task spec: Test Remote Execution of Builds & Tests"),
    ("37-ragie-provisioning-integration.md",     13134, "PROD-71", "Task spec: Ragie Provisioning / Simple Integration"),
    ("38-cloud-run-agents.md",                   11372, "PROD-72", "Task spec: Explore Enabling Cloud-Run Agents"),
    ("39-autoscaling-policy.md",                 12835, "PROD-73", "Task spec: Autoscaling Policy & Tools"),
    ("40-docs-cleanup.md",                       14426, "PROD-74", "Task spec: Clean Up / Organize viberoots Docs"),
    ("41-make-viberoots-public.md",              15808, "PROD-75", "Task spec: Make viberoots Public"),
    ("42-changelog-generation.md",                9704, "PROD-76", "Task spec: Changelog Generation"),
    ("43-supabase-project-provisioning.md",       5045, "PROD-34", "Task spec: Supabase Project Provisioning"),
    ("44-kubernetes-cluster-provisioning.md",     5084, "PROD-35", "Task spec: Kubernetes Cluster Provisioning"),
]


def graphql(query, variables=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": API_KEY},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    if "errors" in result:
        raise RuntimeError(f"GraphQL errors: {result['errors']}")
    return result["data"]


PROJECT_ID = "7184f367-2e04-46b2-8fe1-7103fa38bb24"


def resolve_issue_ids(identifiers):
    """Return {identifier: uuid} for all issues in the project."""
    query = f'{{ project(id: "{PROJECT_ID}") {{ issues {{ nodes {{ id identifier }} }} }} }}'
    data = graphql(query)
    return {n["identifier"]: n["id"] for n in data["project"]["issues"]["nodes"]}


FILE_UPLOAD_MUTATION = """
mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
  fileUpload(filename: $filename, contentType: $contentType, size: $size) {
    uploadFile {
      uploadUrl
      assetUrl
      headers { key value }
    }
  }
}
"""

ATTACHMENT_CREATE_MUTATION = """
mutation AttachmentCreate($issueId: String!, $url: String!, $title: String!) {
  attachmentCreate(input: { issueId: $issueId, url: $url, title: $title }) {
    success
    attachment { id }
  }
}
"""


def attach_file(fname, size, issue_uuid, title):
    filepath = os.path.join(TASKDIR, fname)

    # Step 1: get signed upload URL
    data = graphql(FILE_UPLOAD_MUTATION, {
        "filename": fname,
        "contentType": "text/markdown",
        "size": size,
    })
    upload_info = data["fileUpload"]["uploadFile"]
    upload_url = upload_info["uploadUrl"]
    asset_url = upload_info["assetUrl"]
    headers = {h["key"]: h["value"] for h in upload_info["headers"]}

    # Step 2: PUT the file immediately (timing-sensitive)
    with open(filepath, "rb") as f:
        file_data = f.read()

    put_req = urllib.request.Request(upload_url, data=file_data, method="PUT")
    put_req.add_header("content-type", "text/markdown")
    put_req.add_header("cache-control", "public, max-age=31536000")
    for k, v in headers.items():
        put_req.add_header(k, v)
    with urllib.request.urlopen(put_req, timeout=30) as resp:
        status = resp.status
    if status not in (200, 204):
        raise RuntimeError(f"PUT failed: HTTP {status}")

    # Step 3: create the attachment
    data = graphql(ATTACHMENT_CREATE_MUTATION, {
        "issueId": issue_uuid,
        "url": asset_url,
        "title": title,
    })
    if not data["attachmentCreate"]["success"]:
        raise RuntimeError("attachmentCreate returned success=false")


def main():
    identifiers = [row[2] for row in FILES]
    print(f"Resolving {len(identifiers)} issue IDs...")
    id_map = resolve_issue_ids(identifiers)
    missing = [i for i in identifiers if i not in id_map]
    if missing:
        sys.exit(f"ERROR: could not resolve issue IDs: {missing}")
    print(f"Resolved all {len(id_map)} issues.\n")

    ok, failed = 0, []
    for fname, size, identifier, title in FILES:
        issue_uuid = id_map[identifier]
        print(f"  [{identifier}] {fname} ... ", end="", flush=True)
        try:
            attach_file(fname, size, issue_uuid, title)
            print("OK")
            ok += 1
        except Exception as e:
            print(f"FAILED: {e}")
            failed.append((identifier, fname, str(e)))

    print(f"\n{ok}/{len(FILES)} attached successfully.")
    if failed:
        print("Failures:")
        for ident, fn, err in failed:
            print(f"  {ident} {fn}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
