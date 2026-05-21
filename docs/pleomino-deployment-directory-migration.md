# Pleomino Deployment Directory Migration

Pleomino deployment packages now live under the canonical family directory
`projects/deployments/pleomino/`.

| Former package                            | Canonical package                         | Deployment id      |
| ----------------------------------------- | ----------------------------------------- | ------------------ |
| `projects/deployments/pleomino-dev`       | `projects/deployments/pleomino/dev`       | `pleomino-dev`     |
| `projects/deployments/pleomino-staging`   | `projects/deployments/pleomino/staging`   | `pleomino-staging` |
| `projects/deployments/pleomino-prod`      | `projects/deployments/pleomino/prod`      | `pleomino-prod`    |
| `projects/deployments/pleomino-shared`    | `projects/deployments/pleomino/shared`    | shared policies    |
| `projects/deployments/pleomino-infisical` | `projects/deployments/pleomino/infisical` | bootstrap IaC      |

Use the canonical labels in operator commands:

```bash
deploy --deployment //projects/deployments/pleomino/prod:deploy
sprinkleref --check --target //projects/deployments/pleomino/staging:deploy
build-tools/tools/deployments/infisical-bootstrap.ts deployment \
  --target //projects/deployments/pleomino/staging:deploy
```

The migration changes Buck labels and source paths only. Deployment IDs, prerequisite IDs, secret
contract IDs, provider-facing names, managed bootstrap output names, and Infisical credential file
names remain stable.

`platform-*` and `data-room-*` deployments remain in the legacy flat package layout for now. They
include separate OpenTofu stack packages and are not part of the Infisical Pleomino bootstrap
fan-out, so this migration keeps the first canonical-family move limited to the lowest-risk
Pleomino surface.
