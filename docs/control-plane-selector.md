# Control Plane Selector Design

Deployment projects need to select the deployment control plane that owns protected/shared
mutation, admission records, artifact uploads, operator auth, and replay authority. The selection
belongs with the deployment topology in `projects/config`, not in ambient shell state and not in
app packages.

This design is a clean cut-over. There are no compatibility rules for earlier config shapes because
the current system has no external users yet.

## Goals

- Allow two deployment contexts in the same repo to use different control planes.
- Keep the `projects` directory self-contained so it can later be a submodule with its own shared
  and local config.
- Keep app packages backend-neutral. Apps declare logical needs, while deployment contexts select
  provider accounts, secret backends, runtime hosts, and control planes.
- Treat control-plane service authority as checked-in shared topology while keeping credentials out
  of checked-in files.
- Use `secret://`, `config://`, and `runtime://` according to what the value is, not according to
  where the value is consumed.

## Project Config Shape

`projects/config/shared.json` defines named control planes and deployment contexts that select
them:

```json
{
  "schemaVersion": "viberoots-project-config@1",
  "controlPlanes": {
    "viberoots-prod": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.control.unfair.ly",
        "controlPlaneTokenRef": "secret://control-planes/viberoots-prod/service-token"
      },
      "records": {
        "backend": "service"
      }
    },
    "pleomino-prod": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.pleomino.example.com",
        "controlPlaneTokenRef": "secret://control-planes/pleomino-prod/service-token"
      },
      "records": {
        "backend": "service"
      }
    }
  },
  "deploymentContexts": {
    "pleomino-prod": {
      "controlPlane": "pleomino-prod",
      "secretBackend": "infisical/default",
      "aws": {
        "accountId": "123456789012",
        "organizationId": "o-exampleprod",
        "defaultRegion": "us-west-2"
      },
      "infisical": {
        "projectId": "5a927a1a-e78d-433e-affc-17cc051780c0",
        "environment": "prod",
        "defaultPath": "/"
      }
    },
    "pleomino-staging": {
      "controlPlane": "viberoots-prod",
      "secretBackend": "infisical/default",
      "aws": {
        "accountId": "210987654321",
        "organizationId": "o-examplestaging",
        "defaultRegion": "us-west-2"
      },
      "infisical": {
        "projectId": "5a927a1a-e78d-433e-affc-17cc051780c0",
        "environment": "staging",
        "defaultPath": "/"
      }
    }
  }
}
```

The `controlPlanes` section is checked in because the selected control-plane endpoint and authority
boundary are shared repo topology. Token values are not checked in. A checked-in control-plane
profile may point at a secret ref for the service token, or at a runtime ref when the selected
runtime host supplies the token through a host-local credential contract.

`projects/config/local.json` may override shared values for local testing, but commands must report
active local overrides with the same redaction rules used by existing project config overrides. Set
`VBR_DISALLOW_LOCAL_OVERRIDES=1` to fail if a local override changes shared topology.

## Field Semantics

`controlPlanes.<name>.serviceClient.controlPlaneUrl` is the public HTTPS endpoint for the selected
deployment control-plane service. It is non-secret shared topology, so it is stored as a plain
checked-in URL. Protected/shared mutation must continue to enforce the existing transport policy:
production endpoints require HTTPS, with only reviewed local/dev exceptions.

`controlPlanes.<name>.serviceClient.controlPlaneTokenRef` identifies the credential used by
automation or local tools to authenticate to that control plane. The value is secret material when
resolved, so the selector must not accept a plaintext token. Use:

- `secret://control-planes/<control-plane>/service-token` when the token is stored in SprinkleRef,
  Infisical, Vault, Keychain, or another secret backend.
- `runtime://control-planes/<control-plane>/service-token` when the token is supplied by the
  runtime host contract, such as a mounted file, CI secret variable, or deployment-control-plane
  credential directory.

`records.backend` defines how clients interact with deployment records for protected/shared
targets. The initial clean-cut-over value is `service`, which means clients read and mutate records
through the selected control-plane service instead of using local `recordsRoot` or direct
`control-plane-database-url` access.

## Ref Classification

Use the ref scheme that matches the value being declared:

- `secret://` for credentials, API tokens, private keys, OAuth client secrets, database passwords,
  service bearer tokens, Infisical Universal Auth client secrets, and provider API tokens.
- `config://` for non-secret shared coordinates such as domains, account ids, organization ids,
  project refs, regions, project names, zone ids, service URLs, and selected control-plane names.
- `runtime://` for non-secret or secret values whose source is the current execution host rather
  than shared repo topology, such as mounted credential file names, CI secret variable bindings,
  local socket paths, or host-specific service-token delivery.

A value can be operationally sensitive without being secret. AWS account ids, Supabase project refs,
Infisical project ids, Cloudflare zone ids, public domains, and control-plane URLs are shared
configuration, not `secret://` values. They may still be redacted from some user-facing output if
the output is broad, but the resolver classification should remain `config://` or plaintext shared
config.

Control-plane service tokens are always `secret://` or `runtime://`, never `config://` and never
plaintext JSON.

## Deployment Context Resolution

Deployment metadata selects a context:

```python
deployment_context = "pleomino-prod"
```

Context resolution must:

1. Load `projects/config/shared.json`, then deep-merge `projects/config/local.json`.
2. Validate `deploymentContexts.<selector>`.
3. Validate `deploymentContexts.<selector>.controlPlane` when present.
4. Resolve the selected control-plane profile from `controlPlanes`.
5. Attach normalized control-plane metadata to the deployment graph node.

The normalized graph node should contain one provider-neutral field:

```json
{
  "control_plane": {
    "name": "pleomino-prod",
    "service_client": {
      "control_plane_url": "https://deploy.pleomino.example.com",
      "control_plane_token_ref": "secret://control-planes/pleomino-prod/service-token"
    },
    "records": {
      "backend": "service"
    }
  }
}
```

This field is derived data. Deployment packages should not hand-write it.

## Selection Rules

Protected/shared deployments must select exactly one control-plane service authority.

The default selection source is the deployment context:

1. Deployment target declares `deployment_context`.
2. The context declares `controlPlane`.
3. The named control-plane profile supplies the service endpoint and token contract.

Explicit operator flags may override the selected profile only when the command has an explicit
override flag. The intended clean-cut-over behavior is:

- `--control-plane-url` without a selected context remains valid for ad hoc protected/shared
  commands that do not have deployment metadata.
- If a deployment context selects a control plane and `--control-plane-url` points somewhere else,
  mutating commands fail closed unless the operator passes `--allow-control-plane-override`.
- `VBR_DEPLOY_CONTROL_PLANE_URL` is an escape hatch for commands without context. It must not
  silently override a context-selected control plane.
- `--remote mini` should become a named profile selector, not a magic endpoint path. Under this
  clean cut-over, `mini` should be represented in `controlPlanes` if it remains a supported
  operator convenience.

The command output should report the selected control-plane name, URL, and selection source. It
must not print token values.

## Validation

Project config validation must reject:

- `deploymentContexts.<name>.controlPlane` that does not match a key in `controlPlanes`.
- Protected/shared deployment contexts without a selected control plane.
- `controlPlaneUrl` values that fail the protected/shared transport policy.
- Plaintext `controlPlaneToken`, `token`, `bearerToken`, or similar fields in shared or local
  project config.
- `controlPlaneTokenRef` values that are not `secret://...` or `runtime://...`.
- Direct local `recordsRoot` or direct backend database selection for protected/shared targets
  when `records.backend` is `service`.
- Disagreement between deployment metadata and selected context values.

Read-only commands may report missing or invalid control-plane selection as a diagnostic. Mutating
protected/shared commands must fail before provider mutation, artifact upload, admission write, or
record write.

## Runtime Host Interaction

Runtime hosts stay responsible for delivering credentials to the process that performs the deploy.
The control-plane selector only names the needed credential contract.

Examples:

```json
{
  "controlPlanes": {
    "github-prod": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.control.example.com",
        "controlPlaneTokenRef": "runtime://github-actions/control-plane-token"
      }
    }
  },
  "runtimeHosts": {
    "github-actions": {
      "backend": "github-actions",
      "namePrefix": "VIBEROOTS_"
    }
  }
}
```

For an operator laptop:

```json
{
  "controlPlanes": {
    "local-dev": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.dev.example.com",
        "controlPlaneTokenRef": "secret://control-planes/local-dev/service-token"
      }
    }
  }
}
```

Both forms are valid. Use `secret://` when the resolver reads the token from a secret backend. Use
`runtime://` when the selected host profile supplies the token by contract and the deploy command
only needs to verify that the runtime binding exists.

## Examples

Two deployment projects in one repo can use different control planes:

```json
{
  "controlPlanes": {
    "commerce-prod": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.commerce.example.com",
        "controlPlaneTokenRef": "secret://control-planes/commerce-prod/service-token"
      }
    },
    "internal-tools-prod": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.internal.example.com",
        "controlPlaneTokenRef": "secret://control-planes/internal-tools-prod/service-token"
      }
    }
  },
  "deploymentContexts": {
    "commerce-prod": {
      "controlPlane": "commerce-prod",
      "secretBackend": "infisical/commerce"
    },
    "internal-tools-prod": {
      "controlPlane": "internal-tools-prod",
      "secretBackend": "infisical/internal-tools"
    }
  }
}
```

Two environments for one deployment project can share one control plane while still using different
provider accounts:

```json
{
  "deploymentContexts": {
    "pleomino-staging": {
      "controlPlane": "viberoots-prod",
      "aws": {
        "accountId": "210987654321"
      }
    },
    "pleomino-prod": {
      "controlPlane": "viberoots-prod",
      "aws": {
        "accountId": "123456789012"
      }
    }
  }
}
```

This is allowed because deployment context selects both the provider topology and the
control-plane service authority. They do not need to vary together.

## Implementation Scope

The clean cut-over implementation should:

1. Add `controlPlanes` to the project config type.
2. Add `controlPlane` to deployment context validation.
3. Attach normalized `control_plane` metadata during deployment context resolution.
4. Update protected/shared front doors to use context-selected `control_plane` before ambient env
   fallback.
5. Replace magic `--remote mini` handling with a named control-plane profile or reject it unless a
   matching profile exists.
6. Reject plaintext token fields and malformed token refs.
7. Update docs and command help to describe context-selected control planes as the default path.
8. Add tests for two contexts selecting different control planes, context-selected service routing,
   override rejection, token-ref validation, and local override diagnostics.

Because this is a clean cut-over, the implementation should remove code and docs that imply a
single repo-global deployment service endpoint for all protected/shared deployments.
