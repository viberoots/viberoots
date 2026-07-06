# Deployment Control-Plane Observability

This document describes the operator-facing observability contract implemented for protected/shared
deployment control-plane records under `build-tools/tools/deployments`.

## Surfaces

- Derived operator view: `build-tools/tools/deployments/deployment-control-plane-observability.ts`
- Shared redaction boundary: `build-tools/tools/deployments/deployment-control-plane-redaction.ts`
- Process lifecycle logs:
  `build-tools/tools/deployments/control-plane-process-logging.ts`
- Durable deploy records:
  - `build-tools/tools/deployments/nixos-shared-host-records.ts`
  - `build-tools/tools/deployments/cloudflare-pages-records.ts`

## Audit And Lifecycle Signals

The operator view derives structured events from authoritative control-plane submissions, deploy
records, break-glass evidence, and resilience status. The required categories covered by the view
include:

- submission and pending-approval visibility
- lock waiting and contention visibility
- mutation start visibility
- cancellation visibility
- recovery visibility
- preview-cleanup visibility
- break-glass invocation visibility
- run finish or failure visibility

## Metrics And Alerts

The operator view exposes:

- queue depth and oldest queue age
- oldest running age
- lock-contention count
- failure counts by `finalOutcome`
- failure counts by `failedStep`
- in-doubt run count
- recovered-run count
- latest backup timestamp
- latest restore-test timestamp and status

The reviewed alert set currently includes:

- repeated target failure
- lock contention
- in-doubt runs present
- restore-test failure

## Redaction Boundary

Operator-visible payloads use one of these reviewed classes:

- `display_safe`: short, clearly safe text may be shown directly
- `redact_before_display`: suspicious or uncertain text is reduced to a redacted summary plus a
  stable fingerprint
- `reference_only`: secret-bearing or uncertain artifact files are exposed only as a stable
  pointer/fingerprint pair

This boundary applies to operator-visible deploy errors and referenced artifacts such as replay
snapshots, execution snapshots, plan artifacts, and break-glass evidence.

## Process Lifecycle Logs

Long-running service and worker processes emit JSON lifecycle logs with schema
`deployment-control-plane-process-log@1`. Each entry includes a `correlationId`, process `mode`,
and the non-secret `instanceId` or `workerId` when available. Worker startup, shutdown, and
execution errors use the same redaction boundary as operator-visible control-plane records, so
provider tokens, database URLs, artifact-store keys, and secret-bearing diagnostic text are not
logged directly.

## Operator Expectations

- Redaction is intentional, not data loss.
- Fingerprints are stable troubleshooting handles for correlating records without exposing raw
  payload content.
- Record-adjacent artifacts remain inspectable through their stored paths, but the standard
  operator-facing observability surface does not inline their raw contents.
- Resource graph runtime evidence persists only redacted documents or durable validated references.
  The backend importer rejects raw or malformed admitted observability evidence before it can appear
  in graph status.

## AWS EC2 Observability Evidence

The resource graph accepts `aws-ec2-control-plane-observability@1` evidence only when it is complete
enough to remain useful after redaction. The evidence object must include:

- `checkedAt` within the accepted freshness window.
- `provider: "aws-ec2"`.
- `logSink.kind` of `cloudwatch` or `reviewed-alternate`, plus `retentionDays` and
  `accessControlDigest`.
- `unitLogRouting` entries for the reviewed service/worker units.
- `history.readiness` and `history.workerHeartbeat` set to `true`.
- every required AWS EC2 alarm id, with a non-empty `target` and `action`.

If the importer rejects observability evidence, fix the producer or admitted runtime source rather
than editing the resource graph read model. The read model is non-authoritative and must not become
the place where operators patch runtime evidence by hand.
