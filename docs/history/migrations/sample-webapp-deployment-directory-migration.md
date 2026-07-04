# Sample webapp Deployment Directory Migration

Sample webapp deployment packages now live under the canonical family directory
`projects/deployments/sample-webapp/`.

| Former package                                 | Canonical package                              | Deployment id           |
| ---------------------------------------------- | ---------------------------------------------- | ----------------------- |
| `projects/deployments/sample-webapp-dev`       | `projects/deployments/sample-webapp/dev`       | `sample-webapp-dev`     |
| `projects/deployments/sample-webapp-staging`   | `projects/deployments/sample-webapp/staging`   | `sample-webapp-staging` |
| `projects/deployments/sample-webapp-prod`      | `projects/deployments/sample-webapp/prod`      | `sample-webapp-prod`    |
| `projects/deployments/sample-webapp-shared`    | `projects/deployments/sample-webapp/shared`    | shared policies         |
| `projects/deployments/sample-webapp-infisical` | `projects/deployments/sample-webapp/infisical` | bootstrap IaC           |

Use the canonical labels in operator commands:

```bash
deploy --deployment //projects/deployments/sample-webapp/prod:deploy
sprinkleref --check --target //projects/deployments/sample-webapp/staging:deploy
build-tools/tools/deployments/infisical-bootstrap.ts deployment \
  --target //projects/deployments/sample-webapp/staging:deploy
```

The migration changes Buck labels and source paths only. Deployment IDs, prerequisite IDs, secret
contract IDs, provider-facing names, managed bootstrap output names, and Infisical credential file
names remain stable.

Sample webapp is the only checked-in live deployment family. Earlier planning drafts described additional
Phase 0 families and separate OpenTofu stack packages, but those speculative packages were removed
from the current deployment inventory. Add future approved deployment families under their own
canonical family directories in the same change that updates the live-family guard.
