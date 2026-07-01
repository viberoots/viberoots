import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUCK_PROJECT_IGNORE_LINE,
  withBuckProjectIgnorePolicy,
} from "../../lib/buck-project-ignore";

test("buck project ignore policy excludes mutable non-build state", () => {
  const ignored = BUCK_PROJECT_IGNORE_LINE.replace(/^ignore = /, "").split(/,\s*/);
  assert.equal(ignored.includes(".git"), true);
  assert.equal(ignored.includes(".direnv"), true);
  assert.equal(ignored.includes(".viberoots/buck/tmp"), true);
  assert.equal(ignored.includes(".viberoots/workspace/viberoots-flake-input"), true);
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
ignore = .git, .direnv, .viberoots/buck, .viberoots/buck/tmp, .viberoots/workspace/buck/tmp, .viberoots/workspace/viberoots-flake-input, .claude/worktrees, .codex/worktrees
`,
  );
});
