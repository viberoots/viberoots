# Architecture Decision Records

ADRs capture accepted architecture decisions. Some older ADRs have status notes where implementation
has evolved; current operator manuals remain the source of truth for commands.

| ADR                                                 | Title                             | Status                                         | Current Scope                                                                                      |
| --------------------------------------------------- | --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [00001](00001-monorepo-structure.md)                | Monorepo Structure                | Accepted                                       | Repo layout and ownership boundaries.                                                              |
| [00002](00002-deployment-target-strategy.md)        | Deployment Target Strategy        | Accepted                                       | Deployment target model.                                                                           |
| [00003](00003-auth-identity-architecture.md)        | Auth Identity Architecture        | Accepted with current-doc status notes         | Auth and identity policy; see current control-plane and secrets docs for supported provider flows. |
| [00004](00004-tenant-isolation-model.md)            | Tenant Isolation Model            | Accepted                                       | Tenant and deployment isolation.                                                                   |
| [00005](00005-control-plane-data-plane-boundary.md) | Control Plane Data Plane Boundary | Accepted                                       | Boundary between orchestration and data-plane mutation.                                            |
| [00006](00006-secrets-management-strategy.md)       | Secrets Management Strategy       | Accepted with superseding implementation notes | Secret URI contract, Vault/Infisical behavior, bootstrap boundaries.                               |
| [00007](00007-infrastructure-as-code-standard.md)   | Infrastructure As Code Standard   | Accepted                                       | Durable infrastructure stays declarative/IaC-owned.                                                |
| [00008](00008-remote-execution-security-model.md)   | Remote Execution Security Model   | Accepted, deployment-execution scoped          | Protected/shared deployment execution security, not Buck2 build RE setup.                          |
