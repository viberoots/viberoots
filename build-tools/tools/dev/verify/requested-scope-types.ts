import type { DocumentationImpactDiagnostics } from "../../lib/documentation-impact-selector";
import type { DeploymentImpactDiagnostics } from "../../lib/deployment-impact-selector";
import type { ProjectImpactSelectorDiagnostics } from "../../lib/project-impact-selector";
import type { ProjectEnforcementSelectionReason } from "./project-enforcement-selection";
import type {
  VerifySelectionDiagnostics as VerifyTemplateSelectionDiagnostics,
  VerifyTemplateScopeDecision,
} from "./template-test-scope";

export type VerifyDeploymentScopeMode = "auto" | "always" | "never";

export type DeploymentVerifySelectionDiagnostics = DeploymentImpactDiagnostics & {
  requestedMode: VerifyDeploymentScopeMode;
  deploymentDomainTargets: string[];
  deploymentSafetyFloorTargets: string[];
  projectTargets: string[];
  projectImpactDiagnostics: ProjectImpactSelectorDiagnostics | null;
  selectedTargets: string[];
};

export type VerifyScopeDecision = Omit<
  VerifyTemplateScopeDecision,
  "selectorMode" | "diagnostics"
> & {
  projectEnforcementReason: ProjectEnforcementSelectionReason;
  projectEnforcementChangeAuthorityFailure?: string;
  requestedDeploymentMode: VerifyDeploymentScopeMode;
  selectorMode:
    | VerifyTemplateScopeDecision["selectorMode"]
    | "all-tests"
    | "documentation-contract"
    | "deployment-only"
    | "deployment-and-project-impact";
  diagnostics:
    | VerifyTemplateSelectionDiagnostics
    | DeploymentVerifySelectionDiagnostics
    | DocumentationImpactDiagnostics
    | null;
};
