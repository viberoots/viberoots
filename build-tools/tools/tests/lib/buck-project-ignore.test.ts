import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUCK_PROJECT_IGNORE_LINE,
  BUCK_SOURCE_PROJECT_IGNORE_LINE,
  withBuckProjectIgnorePolicy,
} from "../../lib/buck-project-ignore";

test("buck project ignore policy excludes mutable non-build state", () => {
  const ignored = BUCK_PROJECT_IGNORE_LINE.replace(/^ignore = /, "").split(/,\s*/);
  assert.equal(ignored.includes(".git"), true);
  assert.equal(ignored.includes(".direnv"), true);
  assert.equal(ignored.includes(".codex-logs"), true);
  assert.equal(ignored.includes(".viberoots"), false);
  assert.equal(ignored.includes(".viberoots/buck/tmp"), true);
  assert.equal(ignored.includes(".viberoots/workspace/viberoots-flake-input"), true);
  assert.equal(ignored.includes(".viberoots/workspace/cargo-home"), true);
  assert.equal(ignored.includes(".viberoots/cargo-home"), true);
  assert.equal(ignored.includes("viberoots"), true);
  assert.equal(ignored.includes("viberoots/.direnv"), true);
  assert.equal(ignored.includes("viberoots/.viberoots"), true);
  assert.equal(ignored.includes("viberoots/buck-out"), true);
});

test("buck project ignore policy migrates existing generated configs", () => {
  const before = `[buildfile]
name = TARGETS

[project]
ignore = .viberoots/buck,.viberoots/workspace/buck/tmp,.claude/worktrees,.codex/worktrees
`;

  assert.equal(
    withBuckProjectIgnorePolicy(before),
    `[buildfile]
name = TARGETS

[project]
${BUCK_PROJECT_IGNORE_LINE}
`,
  );
});

test("buck source project ignore policy excludes all clone-local workspace state", () => {
  const ignored = BUCK_SOURCE_PROJECT_IGNORE_LINE.replace(/^ignore = /, "").split(/,\s*/);
  assert.equal(ignored.includes(".viberoots"), true);
  assert.equal(ignored.includes(".codex-logs"), true);
});
