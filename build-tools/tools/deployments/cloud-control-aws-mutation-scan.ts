const AWS_MUTATION_ACTIONS = {
  ec2: [
    "run-instances",
    "terminate-instances",
    "create-launch-template",
    "modify-launch-template",
    "delete-launch-template",
    "create-security-group",
    "delete-security-group",
    "authorize-security-group-ingress",
    "authorize-security-group-egress",
    "revoke-security-group-ingress",
    "revoke-security-group-egress",
    "create-tags",
    "delete-tags",
  ],
  autoscaling: [
    "create-auto-scaling-group",
    "update-auto-scaling-group",
    "delete-auto-scaling-group",
    "attach-instances",
    "detach-instances",
    "put-scaling-policy",
  ],
  iam: [
    "create-role",
    "delete-role",
    "update-role",
    "tag-role",
    "untag-role",
    "create-instance-profile",
    "delete-instance-profile",
    "tag-instance-profile",
    "untag-instance-profile",
    "add-role-to-instance-profile",
    "remove-role-from-instance-profile",
    "attach-role-policy",
    "detach-role-policy",
    "put-role-policy",
    "delete-role-policy",
    "create-policy",
    "delete-policy",
    "tag-policy",
    "untag-policy",
    "create-policy-version",
    "delete-policy-version",
    "set-default-policy-version",
    "update-assume-role-policy",
    "put-role-permissions-boundary",
    "delete-role-permissions-boundary",
  ],
} as const;

const MUTATION_COMMAND_PATTERNS = Object.entries(AWS_MUTATION_ACTIONS).flatMap(
  ([service, actions]) => actions.flatMap((action) => actionPatterns(service, action)),
);

export function directAwsMutationErrors(id: string, value: unknown): string[] {
  const raw = JSON.stringify(value);
  const hyphenated = raw.replace(/[^\w-]+/g, " ");
  const tokenized = raw.replace(/[^\w]+/g, " ");
  const matched = MUTATION_COMMAND_PATTERNS.find(
    (pattern) => pattern.test(hyphenated) || pattern.test(tokenized),
  );
  return matched
    ? [`${id}: custom provider hook evidence contains direct AWS mutation command`]
    : [];
}

function actionPatterns(service: string, action: string): RegExp[] {
  const hyphenated = escapeRegex(action);
  const tokenized = action.split("-").map(escapeRegex).join("\\s+");
  return [
    new RegExp(`\\baws\\s+${escapeRegex(service)}\\s+${hyphenated}\\b`, "i"),
    new RegExp(`\\baws\\s+${escapeRegex(service)}\\s+${tokenized}\\b`, "i"),
  ];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
