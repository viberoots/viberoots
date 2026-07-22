import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePublicationSubjects } from "../../ci/publication-subject-authority";

const component = "//projects/apps/viberoots-site:app";
const production = {
  name: "//projects/deployments/viberoots-site-prod:deploy",
  labels: ["kind:deployment", "deployment-component:static-webapp"],
  protection_class: "production_facing",
  components: [{ id: "default", kind: "static-webapp", target: component }],
};

test("publication subjects derive only from production deployment components", () => {
  const subjects = resolvePublicationSubjects({
    nodes: [
      production,
      {
        ...production,
        name: "//sandbox/deployments/demo:deploy",
        protection_class: "local_only",
        components: [{ kind: "static-webapp", target: "//sandbox/apps/demo:app" }],
      },
    ],
  });
  assert.deepEqual(subjects, [
    {
      kind: "publication",
      subjectId: `static-webapp:${component}`,
      target: component,
      deploymentComponents: ["//projects/deployments/viberoots-site-prod:deploy"],
      outputRole: "static-webapp",
      subjectSetDigest: subjects[0]!.subjectSetDigest,
    },
  ]);
  assert.match(subjects[0]!.subjectSetDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("publication authority rejects production deployments without explicit components", () => {
  assert.throws(
    () => resolvePublicationSubjects({ nodes: [{ ...production, components: [] }] }),
    /no declared components/,
  );
});
