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

Pleomino is the only checked-in live deployment family. Earlier planning drafts described additional
Phase 0 families and separate OpenTofu stack packages, but those speculative packages were removed
from the current deployment inventory. Add future approved deployment families under their own
canonical family directories in the same change that updates the live-family guard.
