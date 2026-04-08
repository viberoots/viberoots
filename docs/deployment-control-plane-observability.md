# Deployment Control-Plane Observability

This document describes the operator-facing observability contract implemented for protected/shared
deployment control-plane records under `build-tools/tools/deployments`.

## Surfaces

- Derived operator view: `build-tools/tools/deployments/deployment-control-plane-observability.ts`
- Shared redaction boundary: `build-tools/tools/deployments/deployment-control-plane-redaction.ts`
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

## Operator Expectations

- Redaction is intentional, not data loss.
- Fingerprints are stable troubleshooting handles for correlating records without exposing raw
  payload content.
- Record-adjacent artifacts remain inspectable through their stored paths, but the standard
  operator-facing observability surface does not inline their raw contents.
