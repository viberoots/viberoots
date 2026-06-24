# Deployment Control Plane MCP

The service exposes a minimal read-only HTTP MCP endpoint when `mcp.enabled` is true. The endpoint
is mounted at `mcp.basePath`, defaulting to `/mcp`, and uses the same service bearer-token
authentication, read models, redaction, and durable audit table as the service API and web UI.

Production MCP requests must include the reviewed service token:

```http
Authorization: Bearer <reviewed service token>
X-Request-Id: mcp-request-123
```

Local unauthenticated MCP is allowed only when the service is explicitly started in fixture mode.
Setting `mcp.enabled: false` removes the endpoint; callers receive the normal service 404 response.

## V1 Surface

The v1 MCP surface has no mutation tools. It exposes these read-only tools and matching resources:

- `deployment_control_plane_status`: database, artifact-store, worker, and instance readiness
- `deployment_queue`: recent submission summaries
- `deployment_detail`: latest non-secret state for one `deploymentId`
- `deployment_auth_context`: authenticated principal and non-secret grants

The matching resources are:

- `mcp://deployment-control-plane/status`
- `mcp://deployment-control-plane/queue`
- `mcp://deployment-control-plane/deployments/{deploymentId}`
- `mcp://deployment-control-plane/auth-context`

Unknown methods, unknown tools, unsupported resources, malformed JSON bodies, and oversized request
bodies return generic MCP errors and do not expose deployment mutation helpers.

Each response includes a `requestId`. If the caller supplies `X-Request-Id`, the service returns
that value; otherwise it generates one. The same request id is written to
`control_plane_audit_events` with the MCP operation, result, and target deployment id when one is
part of the request.

## Example Calls

List available tools:

```json
{ "jsonrpc": "2.0", "id": "tools", "method": "tools/list", "params": {} }
```

Read a deployment detail:

```json
{
  "jsonrpc": "2.0",
  "id": "detail",
  "method": "tools/call",
  "params": {
    "name": "deployment_detail",
    "arguments": { "deploymentId": "example-staging" }
  }
}
```

Read the same deployment detail as a resource:

```json
{
  "jsonrpc": "2.0",
  "id": "detail-resource",
  "method": "resources/read",
  "params": {
    "uri": "mcp://deployment-control-plane/deployments/example-staging"
  }
}
```

Example redacted response shape:

```json
{
  "jsonrpc": "2.0",
  "id": "detail",
  "result": {
    "requestId": "mcp-request-123",
    "tool": "deployment_detail",
    "data": {
      "schemaVersion": "control-plane-read-deployment@1",
      "deploymentId": "example-staging",
      "currentStages": [],
      "latestRun": {
        "deployRunId": "deploy-20260515-001",
        "finalOutcome": "publish_failed",
        "error": "token=<redacted>",
        "artifactIdentity": "static-webapp:example-app"
      }
    }
  }
}
```

Response payloads are intentionally smaller than internal deployment records. Secret-looking
fields, provider tokens, Infisical credentials, artifact contents, raw environment dumps, and
unredacted errors are redacted before the MCP response is written.

## Future Mutation Tools

Future mutation-capable MCP tools must reuse the CLI and web authorization grants, idempotency
keys, payload fingerprinting, dry-run or plan-first behavior, and durable audit records. MCP must
never provide ambient provider credentials or direct Infisical/Vault secret access to an agent.
