# 32. Internal PKI / Service Auth Strategy

**Tier:** Security Hardening
**Priority:** 32 of 44
**Depends on:** #4 Containerize Control Plane, #5 Kubernetes / OpenTofu Deployment, #7 Auth Provisioning IaC
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Decide how services authenticate to each other (cert-manager, Infisical PKI, or SPIFFE/SPIRE), provision PKI certificates via OpenTofu, and update the control plane credential mount contract to support mTLS alongside the existing bearer token.

## What

Design and implement a service-to-service authentication strategy for the viberoots control plane
and its companion services. This covers two related concerns:

**Internal PKI** — an internal certificate authority (CA) that issues TLS certificates to services
running inside the cluster, enabling mutual TLS (mTLS) between processes that do not have an
externally routable HTTPS identity. Candidates: `cert-manager` with a self-signed ClusterIssuer
(Kubernetes-native), SPIFFE/SPIRE for SVID-based workload identity, or a Infisical PKI secrets engine
for short-lived leaf certificates.

**Service auth strategy** — the mechanism by which services prove their identity to each other at
request time without human-visible credentials. The current architecture (ADR-00003, ADR-00005)
uses bearer token auth for the control plane HTTP API (file-backed credentials mounted at runtime)
and Infisical Universal Auth (client ID + client secret, mounted as files) for worker-to-Infisical
calls. Both patterns work for a single-service topology but require explicit design decisions before
additional services — monitoring exporters, data-plane sidecars, future MCP servers, or
Supabase-auth adapters — are added.

Concrete decisions this task must produce:

1. **Ingress-to-service TLS termination model** — whether TLS is terminated at the reverse proxy /
   ingress only (current model) or whether the service itself presents a certificate so in-cluster
   traffic is also encrypted.
2. **Worker-to-service auth model** — whether workers continue to present a static file-backed
   bearer token to the service API, or whether a machine identity (mTLS client cert, SPIFFE SVID,
   or short-lived Infisical Universal Auth token) replaces it.
3. **Service-to-service auth for new services** — if monitoring, MCP, or other companion processes
   call the control plane API or each other, what credential they present. Options include: shared
   bearer token (current pattern extended), per-service Infisical Universal Auth identity (matches
   ADR-00003 decision for workload credentials), mTLS with cert-manager-issued certificates, or
   SPIFFE/SPIRE SVIDs.
4. **Bootstrap and credential mount conventions** — however service certs or machine-identity tokens
   are issued, they must follow the file-backed credential constraint in ADR-00003 and
   `control-plane-plan.md` PR-1 (no credentials baked into images, no credentials in env vars,
   no Infisical as the bootstrap resolver for its own bootstrap secret).
5. **Rotation policy** — short-lived certs or tokens need an automated renewal path that does not
   require container restarts or re-deployment on each rotation cycle.

## Why Now

The control plane is containerized (task #4) and will run on Kubernetes (task #5). At that point
the topology expands from one host to a cluster with multiple pods and potentially multiple
namespaces. Several new service-to-service communication paths appear that have no currently
reviewed trust model:

- **Worker pods calling the control plane service pod** — currently mediated by a file-backed
  bearer token mounted into the worker container. On Kubernetes this is a secret volume mount,
  which is acceptable, but the token itself has no expiry and no automatic rotation path.
- **Monitoring / metrics scraping** — a Prometheus-compatible scrape endpoint on the control plane
  service (or a sidecar exporter) will need to authenticate the scraper to avoid leaking
  deployment state through metrics.
- **Future MCP and web UI services** — `control-plane-plan.md` PR-5 and PR-6 introduce a web UI
  and MCP endpoint served from the same image. If those surfaces are later split into separate
  processes or sidecar containers, they need a reviewed channel back to the service API.
- **Supabase Auth / WorkOS adapter** — `cloud-control-design.md` Phase 4 introduces an auth
  provider adapter. The adapter may need to call the OIDC discovery endpoint of the chosen
  provider and may need to present an identity of its own to the control plane.

Making viberoots public (task #43) creates a security-conscious audience that will review the
service auth posture. Arriving at that milestone without a documented PKI or service identity
strategy means the system has an implicit trust model that is not reviewed, not auditable, and not
described in any ADR.

The dependency on task #5 (Kubernetes) is load-bearing: `cert-manager` and SPIFFE/SPIRE are
Kubernetes-native tools. Designing PKI before the Kubernetes target exists would require designing
against hypothetical cluster topology. The dependency on task #7 (Auth Provisioning IaC) is also
load-bearing: any new machine identity for a service workload must be declared in OpenTofu and
follow the same `infisical_identity` + `infisical_project_identity` pattern already established
for the control plane, or the identity will be untracked and non-reproducible.

## Risks

**cert-manager complexity vs. Infisical Universal Auth parity.** The existing workload auth model
(ADR-00003) already uses Infisical Universal Auth for service-to-Infisical calls. Introducing a
separate PKI stack (cert-manager + internal CA) for service-to-service calls creates two parallel
auth subsystems that each require provisioning, rotation, and break-glass procedures. A simpler
path is to issue short-lived Infisical access tokens to each service and use those for
service-to-service bearer auth, but that requires Infisical to be reachable for all inter-service
calls, which may not be acceptable for in-cluster communication during an Infisical outage.

**SPIFFE/SPIRE operational overhead.** SPIRE adds a SPIRE Server and per-node SPIRE Agent to the
cluster. This is well-understood in large deployments but is significant operational weight for a
system that currently runs one service and two workers. If the topology stays small, SPIRE may be
overkill.

**Bootstrap circular dependency.** If services obtain their mTLS certificates from a Infisical PKI
engine or SPIRE, that infrastructure must be reachable before services can start. Infisical and SPIRE
themselves need a reviewed bootstrap path that does not depend on the services they authenticate.
ADR-00003 defines the two-category (main / bootstrap) constraint precisely to prevent this
circularity. Any PKI solution must identify its own bootstrap category and prove it does not
resolve through Infisical.

**Certificate rotation and container restart.** Short-lived TLS certificates (e.g. 24h leaf certs
from cert-manager) require either a sidecar that reloads the certificate in the running process or
a restart of the container on renewal. The control plane service and workers are designed to be
restarted cleanly (they are stateless except for Postgres-backed state), but a rotation-driven
restart must not orphan in-flight queue claims or held provider locks. The lease and fencing-token
model from `control-plane-plan.md` PR-2 must be verified to handle this safely.

**Scope creep into mTLS for all traffic.** Requiring mutual TLS for every in-cluster call is
correct from a zero-trust perspective but may be disproportionate for an initial production
deployment. Prioritizing external-to-service TLS (already handled at the reverse proxy / ingress)
and service-to-service authentication (bearer token or SPIFFE SVID) separately from in-cluster
encryption reduces the number of interacting changes in one release.

## Trade-offs

**Extend file-backed bearer tokens vs. adopt mTLS.** The simplest extension of the current model
is to add a per-service bearer token, mounted as a file, for each new service that calls the
control plane API. This is already reviewed (ADR-00003), requires no new infrastructure, and
matches the existing worker credential mount convention. The downside is that static tokens have no
automatic expiry and must be rotated out-of-band. mTLS with cert-manager-issued certificates
provides automatic expiry and rotation but introduces a new CA infrastructure dependency.

**Infisical Universal Auth per service vs. per-service TLS cert.** Issuing each service a
dedicated Infisical machine identity follows the pattern in ADR-00003 ("every new service workload
identity must be provisioned as a machine identity in Infisical"). This gives auditable per-service
access scoping and rotation through the existing Infisical lifecycle tools. It does not provide
transport encryption beyond what TLS at the ingress already provides. TLS certs from cert-manager
provide transport encryption and identity, but require a cert-manager installation and a cluster
issuer as prerequisites.

**cert-manager with self-signed ClusterIssuer vs. Infisical PKI.** If mTLS is adopted,
`cert-manager` with a self-signed `ClusterIssuer` is the lowest-overhead Kubernetes-native option:
no external Infisical installation is needed. Infisical PKI provides certificate lifecycle
management outside the cluster and is more portable if services eventually span clusters, but it
adds a Infisical dependency that does not currently exist in this architecture (ADR-00003 notes Infisical
as the default production secrets backend for env vars but it is not yet operational).

**SPIFFE/SPIRE vs. cert-manager.** SPIFFE SVIDs provide a workload identity standard
(`spiffe://trust-domain/ns/...`) that is portable across runtimes and does not require a specific
CA implementation. cert-manager is Kubernetes-native and simpler to operate for a
single-cluster deployment. For the current scale (one service, two workers, one cluster),
cert-manager is the lower-risk choice; SPIFFE/SPIRE should be reconsidered if the system expands
to multiple clusters or multi-runtime workloads.

## Considerations

**Reviewed decision must produce an ADR.** The outcome of this task is a new ADR (continuing the
`000XX` sequence) that records which service auth mechanism is selected, which PKI option is
adopted or explicitly deferred, and what the per-service credential provisioning pattern looks like.
The ADR must state whether SPIFFE/SPIRE, cert-manager, Infisical PKI, or extended Infisical Universal
Auth is the chosen path, and must record the reasons the other options were rejected.

**File-backed credential constraint is non-negotiable.** Whichever mechanism is selected, the
resulting per-service credential (TLS private key + certificate pair, SPIFFE SVID, or Infisical
client secret) must be mounted into the container as a file. ADR-00003 is explicit: no credential
may be baked into image layers, injected as an environment variable in the image definition, or
stored in deployment records. The NixOS container module (`deployment-control-plane-container-module.nix`)
already wires `systemd LoadCredential=` or equivalent generic `/run/secrets/...` paths; any
service cert or SVID must be delivered through the same mount mechanism, not through a
Kubernetes-native projected volume that bypasses the reviewed credential directory abstraction.

**OpenTofu must declare any new machine identity.** Per task #7 (Auth Provisioning IaC), every
new workload identity must be declared as an OpenTofu resource in the reviewed identity stack,
following the `infisical_identity` + `infisical_project_identity` pattern. If the chosen mechanism
uses cert-manager `Certificate` objects instead of Infisical identities, those objects must still
be declared in reviewed IaC (Helm values or an OpenTofu Kubernetes provider resource block) so
their existence is tracked in state and reproducible from scratch.

**Rotation must not require image rebuilds.** The Nix-built OCI image is pinned by digest for
production deploys. A rotation mechanism that requires pushing a new image digest to rotate a
credential is incompatible with the reviewed image pinning model. Rotation must happen through the
mounted file path (cert-manager `CertificateRequest` renewal writes a new file under
`/run/deployment-control-plane/credentials/`; the process either polls for changes or is restarted
by the container orchestrator with a new mount).

**in-cluster vs. cross-cluster scope.** The initial Kubernetes deployment (task #5) targets a
single cluster. The PKI strategy should be designed for single-cluster first and must explicitly
document what changes would be required to extend it to multi-cluster or multi-runtime topologies
(e.g. adding the current personal server as a secondary host). SPIFFE/SPIRE is the natural answer for multi-cluster;
cert-manager becomes less attractive if the system grows beyond one cluster.

**Interaction with the auth provider abstraction in cloud-control-design.md.** Phase 4 of
`cloud-control-design.md` introduces a Supabase Auth or WorkOS adapter. That adapter will issue
OIDC tokens for human operators but does not directly address service-to-service auth. The PKI
strategy selected in this task must be compatible with the OIDC-based operator auth model and must
not require the OIDC issuer to be reachable for worker-to-service calls that happen at deploy
execution time (workers do not operate on behalf of human sessions; they operate under their own
machine identity).

**sprinkleref --check must cover any new secret references.** If the chosen approach introduces
new `secret://deployments/...` references (e.g. a TLS private key or cert path declared as a
`secret_requirement` in deployment metadata), those references must be registered in the
SprinkleRef resolver configuration before `sprinkleref --check` passes. Missing refs block
protected/shared deploy submission.

**Scope this task to design + initial implementation, not full zero-trust rollout.** The realistic
scope for priority 29 is: make a reviewed decision (ADR), implement the selected mechanism for the
control plane service and workers, prove automatic rotation works, and document the pattern for
adding new services. Full zero-trust enforcement across every future service is a follow-on, not a
prerequisite for going public.
