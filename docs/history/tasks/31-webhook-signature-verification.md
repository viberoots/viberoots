# 34. Webhook Signature Verification Framework

**Tier:** Security Hardening
**Priority:** 34 of 44
**Depends on:** #4 Containerize Control Plane
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Extract the existing HMAC/`timingSafeEqual` pattern from artifact binding into a shared webhook verification helper, apply it to GitHub App webhook routes on the control plane, and register the webhook secret via SprinkleRef.

## What

Add a shared, reusable webhook signature verification module to the control-plane service layer that
any inbound webhook handler can call rather than each integration reimplementing the check
independently.

**Framework shape**

The module lives under `build-tools/tools/deployments/` alongside the other control-plane
infrastructure files. It exports one primary function with a narrow contract:

```ts
verifyWebhookSignature(opts: {
  algorithm: "hmac-sha256";     // only supported value in v1
  secret: string;               // resolved through SprinkleRef / secret runtime, not env vars
  signatureHeader: string;      // raw value of the provider-specific header
  rawBody: Buffer;              // unparsed request bytes, captured before JSON.parse
  headerFormat: "hex" | "sha256=hex";  // GitHub uses "sha256=hex"; others use bare "hex"
}): void                        // returns void; throws on failure (fail-closed)
```

The function uses `crypto.timingSafeEqual` for the MAC comparison — the same pattern already used
in `deployment-artifact-binding.ts` for `verifyArtifactBindingProof`. It throws with a structured
error carrying a machine-readable `code` (`missing_signature`, `unsupported_algorithm`,
`verification_failed`) so callers can produce consistent 401 responses without inspecting error
text.

**Wire-up in the control-plane server**

`nixos-shared-host-control-plane-server.ts` is the HTTP server that handles all inbound requests.
Any new webhook route added to that server (GitHub App events, Cloudflare callbacks, App Store
Connect notifications) calls `verifyWebhookSignature` before reading the request body as JSON. The
raw body must be captured with `readRawBody` (already exported from `control-plane-http.ts`) before
any parsing; the signature is verified against that raw buffer.

**Secret sourcing**

Webhook signing secrets are already modelled in the codebase:

- `github_webhook_secret` at `secret://deployments/<deployment-id>/github/webhook_secret` is
  declared optional in `github-app-requirement-profile.ts` and is wired through the standard
  SprinkleRef / secret-runtime path when `webhooks = True` is set in the Buck rule.
- `source_access_hmac_key` at `secret://deployments/source-access/hmac_key` covers the Source
  Access signing/HMAC profile already listed in `external-deployment-requirements.ts`.

No new secret contract IDs are required. The framework consumes whatever resolved string value the
secret runtime provides; it does not resolve secrets itself.

**Scope of v1**

- HMAC-SHA256 with `crypto.timingSafeEqual` comparison.
- Fail-closed on missing or malformed `signatureHeader`.
- Structured error codes so callers can log and respond uniformly.
- Tests covering: correct MAC accepted, incorrect MAC rejected, missing header rejected, wrong
  algorithm field rejected, timing-safe path exercised.
- No ED25519 or RSA payload-signature support in v1 (Cloudflare webhooks and GitHub App event
  payloads both use HMAC-SHA256; other schemes can extend the `algorithm` discriminant later).

## Why Now

The control-plane server (`nixos-shared-host-control-plane-server.ts`) is about to grow new inbound
surface: GitHub App event callbacks (`github_webhook_url` is already a declared optional runtime
config field), Cloudflare event callbacks, and potentially App Store Connect notifications. Each of
these providers signs payloads with HMAC-SHA256 and expects the receiver to verify the signature
before processing the body.

Without a shared framework, each new route either:

1. reimplements HMAC verification ad hoc, risking timing-oracle vulnerabilities from naive string
   comparison, or
2. silently skips verification because it is not yet written.

Both outcomes are unacceptable for a service that gates protected/shared production deployments. The
deployments-contract.md rule that "trusted CI must provide admission evidence" and the broader
fail-closed posture require that spoofed or tampered inbound payloads are rejected before any
control-plane state changes.

This task is sized S because the crypto primitives are already present in the codebase
(`crypto.createHmac`, `crypto.timingSafeEqual` in `deployment-artifact-binding.ts`), the secret
model is already established (`github_webhook_secret`, `source_access_hmac_key`), and the server
already captures raw bodies via `readRawBody`. The work is consolidating existing patterns into one
reviewed module rather than building new infrastructure.

Doing this before new webhook routes land means the framework is available from the first commit
that adds a GitHub App event handler or a Cloudflare callback route, rather than retrofitting
verification after routes are live.

## Risks

**Raw body capture ordering.** The signature must be computed over the unparsed bytes that arrived
over the wire. If a handler calls `readJsonBody` before `verifyWebhookSignature`, the raw bytes are
consumed and the verification input is wrong. The framework must document that `readRawBody` must
precede `JSON.parse`; a wrapper helper that does both in the correct order is the preferred
mitigation.

**Secret availability at verification time.** The webhook secret must be available at the moment
the HTTP request arrives, not deferred to the worker execution path. If the secret runtime requires
an async admitted context that is not set up at server startup, verification will fail on every
request. The implementation must confirm that `github_webhook_secret` can be resolved synchronously
from the credential file loaded at service startup, or document the async resolution path.

**Provider header format variation.** GitHub uses `X-Hub-Signature-256: sha256=<hex>`. Other
providers use bare `<hex>` or `<algorithm>=<hex>` with different algorithm names. Passing the wrong
`headerFormat` to the framework silently fails verification. Each route that uses the framework must
declare its `headerFormat` explicitly; there must be no default that silently accepts any format.

**Replay attack surface.** HMAC-SHA256 verification proves authenticity but not freshness. A
replayed valid payload from a prior request will pass verification. For routes that trigger
side-effecting state changes, replay protection (timestamp window check, nonce, or idempotency key)
must be added at the route level, not in this framework. The task description for each new webhook
route must call this out explicitly.

## Trade-offs

**Shared module vs. per-handler inline code.** A shared module adds one dependency edge but ensures
timing-safe comparison and structured error codes are used consistently. Per-handler inline code is
simpler to read in isolation but historically leads to divergence: one handler uses
`timingSafeEqual`, the next uses `===`. Given that the codebase already treats `timingSafeEqual` as
the reviewed pattern (it is already used for artifact-binding proof verification), the shared module
is the right call.

**Throw vs. return boolean.** The framework throws rather than returning a boolean so callers
cannot forget to check the return value. The existing `requireReviewedBearerToken` helper in
`deployment-control-plane-service-token.ts` uses a boolean return, but that pattern requires the
caller to write an explicit early-return guard. For signature verification, a thrown structured
error is safer because the request handling code in `nixos-shared-host-control-plane-server.ts`
already wraps all handlers in a `try/catch` that writes a JSON error response.

**v1 HMAC-only vs. multi-algorithm from the start.** Restricting v1 to HMAC-SHA256 keeps the
implementation reviewable and testable in one PR. The `algorithm` field on the call site is a
forward-compatible discriminant; adding ED25519 later requires only a new branch and new tests.
Shipping a multi-algorithm framework before any non-HMAC provider is integrated introduces
untested code paths.

## Considerations

- The `verifyWebhookSignature` function signature should live in a new file
  `webhook-signature-verification.ts` under `build-tools/tools/deployments/`. Do not add it to
  `deployment-artifact-binding.ts`; that file is scoped to the artifact challenge/proof flow and
  its exports are already part of a stable public surface.

- `control-plane-http.ts` already exports `readRawBody`. Consider adding a
  `readRawBodyAndVerifyWebhookSignature` convenience wrapper that calls both in the correct order so
  individual route handlers cannot accidentally call `readJsonBody` first.

- The `requestHasReviewedBearerToken` function in `nixos-shared-host-control-plane-service-auth.ts`
  uses a plain `===` string comparison for the bearer token check. That is acceptable for
  bearer-token header values (constant-time comparison is not required for token equality when the
  token is an opaque secret compared against a server-side value and the response timing is not
  attacker-observable at the token-length level). Webhook MACs are a different case: the MAC is
  computed over attacker-controlled input and the comparison result leaks timing information if not
  constant-time. Do not reuse the bearer-token comparison pattern for MAC comparison.

- The framework's structured error `code` values (`missing_signature`, `unsupported_algorithm`,
  `verification_failed`) must be included in the redaction-safe error surface. The
  `redactDeploymentAuthText` function in `deployment-auth-redaction.ts` currently handles error
  messages before they are written to HTTP responses. Confirm that these codes do not carry secret
  material and are safe to return in the 401 response body verbatim.

- Tests must include a case where the MAC is correct but one byte of the `rawBody` is mutated, to
  confirm the hash input is correctly captured. Tests must also verify that a valid MAC for a
  different payload is rejected, ruling out implementation errors where the hash is computed over
  a constant rather than the body argument.

- The `github_webhook_secret` entry in `github-app-requirement-profile.ts` is currently declared at
  step `publish`. If a GitHub App event handler lives in the control-plane service (which runs
  continuously, not only during a deployment publish step), confirm whether that lifecycle step
  assignment is appropriate for the runtime resolution path, or whether a new `inbound` or
  `service` step is needed.
