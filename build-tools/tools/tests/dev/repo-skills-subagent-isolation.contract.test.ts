import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.env.VIBEROOTS_ROOT || process.cwd();

async function skillFile(skill: "test" | "prs", file: "SKILL.md" | "WORKFLOW.md") {
  return await readFile(path.join(root, "plugins", "repo-skills", "skills", skill, file), "utf8");
}

test("delegated test workflow isolates the tester from parent conversation context", async () => {
  const [entrypoint, workflow] = await Promise.all([
    skillFile("test", "SKILL.md"),
    skillFile("test", "WORKFLOW.md"),
  ]);

  for (const source of [entrypoint, workflow]) {
    assert.match(source, /fork_turns="none"/);
    assert.match(source, /parent\s+conversation/i);
  }
  assert.match(workflow, /smallest concrete follow-up/i);
  assert.match(workflow, /Never send .*verbose test\s+logs/is);
});

test("PR orchestration preserves independent implementation and review contexts", async () => {
  const [entrypoint, workflow] = await Promise.all([
    skillFile("prs", "SKILL.md"),
    skillFile("prs", "WORKFLOW.md"),
  ]);

  for (const source of [entrypoint, workflow]) {
    assert.match(source, /fork_turns="none"/);
    assert.match(source, /parent\s+conversation/i);
  }
  assert.match(workflow, /Reviewer independence is a\s+correctness boundary/is);
  assert.match(workflow, /do not tell a reviewer the implementer's reasoning or expected verdict/i);
  assert.match(workflow, /Never send verbose logs or unrelated implementation history/i);
});
