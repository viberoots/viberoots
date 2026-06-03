#!/usr/bin/env bash
# Attaches each task markdown file to its corresponding Linear issue.
# Uses `claude -p` to invoke Linear MCP tools for prepare/finalize,
# and runs curl immediately after prepare to beat the 60-second signed URL expiry.
set -euo pipefail

TASKDIR="$(cd "$(dirname "$0")" && pwd)"
PROJECTDIR="$(cd "$TASKDIR/../.." && pwd)"
CLAUDE_BIN="/Applications/cmux.app/Contents/Resources/bin/claude"

process_file() {
  local FNAME="$1" SIZE="$2" ISSUE="$3" TITLE="$4"
  local FILEPATH="$TASKDIR/$FNAME"

  echo -n "[$ISSUE] $FNAME ... "

  # Step 1: prepare upload via MCP (claude -p calls prepare_attachment_upload)
  local RESULT
  RESULT=$(cd "$PROJECTDIR" && "$CLAUDE_BIN" -p \
    "Call the linear-server MCP tool prepare_attachment_upload with exactly these parameters:
issue: $ISSUE
filename: $FNAME
contentType: text/markdown
size: $SIZE
title: $TITLE

After the tool call succeeds, output ONLY two bare URLs on two separate lines with no other text:
Line 1: the uploadRequest.url value (starts with https://storage.googleapis.com)
Line 2: the assetUrl value (starts with https://uploads.linear.app)" \
    --allowedTools "mcp__linear-server__prepare_attachment_upload" \
    --dangerously-skip-permissions \
    2>/dev/null)

  local UPLOAD_URL ASSET_URL
  UPLOAD_URL=$(printf '%s\n' "$RESULT" | grep -m1 '^https://storage\.googleapis\.com' || true)
  ASSET_URL=$(printf '%s\n' "$RESULT" | grep -m1 '^https://uploads\.linear\.app' || true)

  if [[ -z "$UPLOAD_URL" || -z "$ASSET_URL" ]]; then
    echo "FAILED (could not parse URLs)"
    echo "  claude output: $RESULT" >&2
    return 1
  fi

  # Step 2: PUT the file immediately (timing-sensitive - must be within 60s of prepare)
  local HTTP_CODE
  HTTP_CODE=$(curl -sf -w "%{http_code}" -o /dev/null -X PUT \
    --data-binary "@$FILEPATH" \
    -H "content-type: text/markdown" \
    -H "cache-control: public, max-age=31536000" \
    -H "x-goog-content-length-range: $SIZE,$SIZE" \
    -H "Content-Disposition: attachment; filename=\"$FNAME\"" \
    "$UPLOAD_URL" || echo "000")

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "FAILED (PUT HTTP $HTTP_CODE)"
    return 1
  fi

  # Step 3: finalize via MCP
  cd "$PROJECTDIR" && "$CLAUDE_BIN" -p \
    "Call the linear-server MCP tool create_attachment_from_upload with exactly these parameters:
issue: $ISSUE
assetUrl: $ASSET_URL
title: $TITLE

Output only 'OK'." \
    --allowedTools "mcp__linear-server__create_attachment_from_upload" \
    --dangerously-skip-permissions \
    2>/dev/null | grep -q 'OK' && echo "OK" || echo "WARN (finalize may have succeeded)"
}

# All 44 files — filename | size | issue (PROD-ID = 32 + priority#) | title
process_file "01-containerize-control-plane.md"        13951 PROD-36 "Task spec: Containerize Control Plane + Move to Cloud"
process_file "02-infisical-secrets-provider.md"        10262 PROD-33 "Task spec: Infisical Secrets Provider"
process_file "03-kubernetes-opentofu-deployment.md"    11161 PROD-37 "Task spec: Simple Kubernetes / OpenTofu Deployment to Bundle Control Plane"
process_file "04-supabase-workos-auth-provider.md"     11066 PROD-38 "Task spec: Supabase/WorkOS Auth Provider"
process_file "05-auth-provisioning-iac.md"              8878 PROD-39 "Task spec: Auth Provisioning IaC"
process_file "06-cloudflare-container-deployment.md"    8438 PROD-40 "Task spec: Container Deployment Provider"
process_file "07-vercel-build-target.md"               10930 PROD-41 "Task spec: Vercel Build Target"
process_file "08-vercel-deployment-provider.md"        15896 PROD-42 "Task spec: Vercel Deployment Provider"
process_file "09-backend-service-build-templates.md"   10510 PROD-43 "Task spec: Backend Service Build Template(s)"
process_file "10-backend-service-deployment-template.md" 11510 PROD-44 "Task spec: Backend Service Deployment Template"
process_file "11-bob-monorepo-setup.md"                10973 PROD-55 "Task spec: Get Bob Set Up with viberoots-Based Monorepo"
process_file "12-bob-deployment-dry-run.md"            13367 PROD-56 "Task spec: Dry Run Deployment Flow with Bob / Iterate"
process_file "13-supabase-db-deployment.md"            11590 PROD-45 "Task spec: Supabase DB Deployment"
process_file "14-health-readiness-contract.md"          9212 PROD-46 "Task spec: Unified Health/Readiness Contract for Services"
process_file "15-centralized-structured-logging.md"    12843 PROD-48 "Task spec: Centralized Structured Logging"
process_file "16-unified-audit-logging.md"             13637 PROD-49 "Task spec: Unified Audit Logging"
process_file "17-simple-monitoring.md"                 14672 PROD-50 "Task spec: Simple Monitoring (Prometheus / OpenTelemetry / Tracing / Status Page)"
process_file "18-dead-letter-queue-strategy.md"        11854 PROD-51 "Task spec: Common Dead-Letter Queue Strategy"
process_file "19-pr-preview-deployments.md"            10577 PROD-52 "Task spec: PR/Preview Deployments"
process_file "20-control-plane-webapp.md"               9255 PROD-54 "Task spec: Simple Control Plane Webapp"
process_file "21-rollout-strategy.md"                  12203 PROD-57 "Task spec: Rollout Strategy (Blue/Green vs. Canary vs. Simple Replace)"
process_file "22-artifact-cache-retention.md"          11942 PROD-58 "Task spec: Artifact Cache / Retention Tools and Policy"
process_file "23-local-stack-deployment.md"            12318 PROD-47 "Task spec: Local Stack Deployment"
process_file "24-adr-process-conventions.md"            9332 PROD-59 "Task spec: Simple ADR Process / Conventions"
process_file "25-document-simple-sdlc.md"               8764 PROD-60 "Task spec: Document Simple SDLC"
process_file "26-multi-tenant-isolation-design.md"     16479 PROD-61 "Task spec: Multi-Tenant Isolation Invariants / Design"
process_file "27-migration-versioning-conventions.md"  16582 PROD-62 "Task spec: Migration/Versioning Conventions for Infra + DB"
process_file "28-forking-strategy.md"                  10052 PROD-63 "Task spec: Decide Forking Strategy for downstream products / viberoots"
process_file "29-internal-pki-service-auth.md"         14458 PROD-64 "Task spec: Internal PKI / Service Auth Strategy"
process_file "30-secret-rotation-policy.md"            14428 PROD-65 "Task spec: Secret Rotation Policy & Workflows"
process_file "31-webhook-signature-verification.md"    10785 PROD-66 "Task spec: Webhook Signature Verification Framework"
process_file "32-supply-chain-scanning.md"             13125 PROD-68 "Task spec: Supply-Chain Scanning"
process_file "33-sbom-generation.md"                    9178 PROD-67 "Task spec: SBOM Generation"
process_file "34-backup-restore-dr.md"                 13865 PROD-69 "Task spec: Validated Backup/Restore/Disaster Recovery Procedures"
process_file "35-control-plane-mcp-surface.md"         10289 PROD-53 "Task spec: Control Plane MCP Surface"
process_file "36-remote-execution-builds-tests.md"     12328 PROD-70 "Task spec: Test Remote Execution of Builds & Tests"
process_file "37-ragie-provisioning-integration.md"    13134 PROD-71 "Task spec: Ragie Provisioning / Simple Integration"
process_file "38-cloud-run-agents.md"                  11372 PROD-72 "Task spec: Explore Enabling Cloud-Run Agents"
process_file "39-autoscaling-policy.md"                12835 PROD-73 "Task spec: Autoscaling Policy & Tools"
process_file "40-docs-cleanup.md"                      14426 PROD-74 "Task spec: Clean Up / Organize viberoots Docs"
process_file "41-make-viberoots-public.md"             15808 PROD-75 "Task spec: Make viberoots Public"
process_file "42-changelog-generation.md"               9704 PROD-76 "Task spec: Changelog Generation"
process_file "43-supabase-project-provisioning.md"      5045 PROD-34 "Task spec: Supabase Project Provisioning"
process_file "44-kubernetes-cluster-provisioning.md"    5084 PROD-35 "Task spec: Kubernetes Cluster Provisioning"

echo "All done."
