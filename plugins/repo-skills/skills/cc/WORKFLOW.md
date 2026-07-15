---
name: cc
description: Commit all uncommitted or local git changes in the current repository with a single conventional commit whose message accurately represents the full change set. Assume required tests and validation have already been performed before this skill is invoked, so commit immediately after inspecting and staging unless blocked by git state or obviously unrelated work. Use when the user asks to commit current work, commit everything locally, create a conventional commit, or make a representative snapshot of the working tree before handing off.
---

# Commit Changes

## Overview

Use this skill to turn the current working tree into one clean conventional commit.

Treat validation as already complete before `cc` is invoked. Inspect the whole change set first, choose a commit type and summary that cover all changes, then stage everything and commit immediately.

## Workflow

1. Confirm the repository state.
2. Understand the full change set before writing the message.
3. Choose the most representative conventional commit type and summary.
4. If the change set includes modified submodules or nested Git repositories, commit those
   repositories first.
5. For viberoots consumer repositories, run the consistency guard before staging. Stop rather than
   committing if viberoots pins, source mode, pnpm hash metadata, or post-clone cleanliness are
   stale.
6. Stage all tracked, deleted, and untracked files in the current repository.
7. Create one commit for the entire local change set immediately, without running extra tests or waiting for additional validation.

## Inspect The Change Set

Start by understanding what would be included in the commit.

- Run `git status --short --branch` to see modified, deleted, renamed, and untracked files.
- Run `git submodule status` when the repository has submodules, and inspect any modified submodule
  before staging the parent repository.
- Run `git diff --stat` and `git diff --cached --stat` to gauge unstaged and staged changes.
- If the summary is not obvious, inspect the most important files with `git diff -- <path>` or `git diff --cached -- <path>`.
- Treat the commit as covering all local changes, not just the most recently edited file.

If there are no local changes, stop and report that there is nothing to commit.

## Commit Submodules First

When a working tree contains modified submodules or nested Git repositories, commit those inner
repositories before committing the parent repository.

- Inspect each changed submodule with `git -C <submodule-path> status --short --branch`.
- If the submodule has local changes, create the submodule commit first using the same `cc` rules:
  inspect the submodule change set, choose a representative conventional commit message, stage the
  submodule's local changes, and commit them inside the submodule.
- After every submodule commit exists, return to the parent repository and re-check the parent
  working tree before staging anything. The parent repository now sees a new submodule gitlink, so
  any viberoots consumer checks performed before the submodule commit are stale and must not be
  reused.
- Only after that post-submodule re-check should you stage the updated submodule gitlink along with
  any parent-repo changes.
- Do not commit the parent repo pointer while the submodule still has uncommitted local changes,
  unless the user explicitly asks to leave those submodule changes uncommitted.

## Guard Viberoots Consumers

Before staging a commit in a viberoots consumer repository, make sure checked-in viberoots pins and
tracked generated metadata are coherent. This prevents committing only one side of the source pin
or leaving stale dependency metadata for the user's next post-clone run.

Treat a repository as a viberoots consumer when it has a `viberoots` submodule or a `.viberoots`
workspace directory. In that case:

- Run this guard after all nested `viberoots` submodule commits are complete and before staging the
  parent repository. Do not rely on a guard result captured before committing the submodule, because
  the submodule `HEAD` and parent gitlink changed after that check.
- Run the repo consistency check when available:

  ```sh
  zx-wrapper viberoots/build-tools/tools/dev/consumer-consistency-check.ts
  ```

- If the consistency check is not available, perform these checks manually:

  ```sh
  gitlink_rev="$(git ls-files -s viberoots | awk '$1 == "160000" { print $2; exit }')"
  submodule_rev="$(git -C viberoots rev-parse HEAD 2>/dev/null || true)"
  prospective_gitlink_rev="${submodule_rev:-${gitlink_rev}}"
  lock_rev="$(jq -r '.nodes.viberoots.locked.rev // empty' flake.lock 2>/dev/null || true)"
  if test -n "$prospective_gitlink_rev" && test -z "$lock_rev"; then
    echo "error: a viberoots submodule requires a committed root flake.lock" >&2
    echo "repair: run viberoots update" >&2
    exit 1
  fi
  test "$(cat .buckroot 2>/dev/null)" = "."
  for path in .buckroot .buckconfig .envrc .gitignore; do
    git ls-files --error-unmatch -- "$path" >/dev/null
  done
  for entry in .viberoots/ buck-out/ .direnv/ .nix-zsh/ .nix-gcroots/ node_modules node_modules/ projects/config/local.json .local/; do
    grep -Fxq -- "$entry" .gitignore
  done
  if git ls-files --error-unmatch -- projects/config/local.json >/dev/null 2>&1; then
    echo "error: projects/config/local.json must remain untracked" >&2
    exit 1
  fi
  ```

  If any required tracked input is missing or stale, or `projects/config/local.json` is tracked, stop
  and tell the user to run exactly `viberoots update`.

- In submodule mode, treat `submodule_rev` as the prospective gitlink because this guard runs after
  the submodule commit and before the parent stages its updated gitlink. Fall back to the indexed
  `gitlink_rev` only when the checkout is unavailable. If `prospective_gitlink_rev` and `lock_rev`
  are present and differ, stop and tell the user to run exactly:

  ```sh
  viberoots update
  ```

- If `.viberoots/current`, `.envrc`, or checked-in flake metadata indicate submodule mode but the
  `viberoots` gitlink is absent, or indicate flake mode while an active `viberoots` gitlink is being
  committed, stop and tell the user to run exactly `viberoots update`.
- Verify committed pnpm hash metadata by running the read-only materialization path for each
  importer with a `pnpm-lock.yaml`, for example:

  ```sh
  find projects viberoots -name pnpm-lock.yaml -print
  zx-wrapper viberoots/build-tools/tools/dev/update-pnpm-hash.ts --lockfile <lockfile> --read-only
  ```

  If this reports stale dependency metadata, stop and tell the user to run exactly `u`. Pin,
  source-mode, and generated bootstrap drift must point to exactly `viberoots update`. The guard
  cannot infer that the user intends to move dependency versions, so it must never invent
  `u --upgrade` as repair guidance; that command is chosen explicitly by the user and reports its
  own unsupported-language diagnostics.

- If any consistency check dirties tracked files, stop. Do not include that dirt in the commit as an
  incidental fix. Use the exact repair command printed by the guard (`u` or `viberoots update`),
  inspect the resulting diff, and rerun the guard before committing.
- If the repository has only flake-mode viberoots metadata and no `viberoots/` submodule, do not
  invent a submodule check; commit the existing flake changes as part of the normal change set.
- If the repository has a viberoots submodule but no root `flake.lock`, stop and tell the user to
  run exactly `viberoots update`. The lock is required committed source metadata, not an optional
  synchronization surface.

## Write The Commit Message

Write a conventional commit message that represents the entire commit, not a subset.

- Prefer the standard types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `style`, `revert`.
- Choose the type based on the primary effect of the whole change set.
- Use a scope only when it adds real clarity, for example `fix(auth): handle expired sessions`.
- Keep the summary short, specific, and representative.
- When the change set mixes several kinds of work, choose the type that best matches the highest-impact outcome; if no stronger type fits, use `chore`.
- Do not mention files, ticket numbers, or implementation trivia unless the user asked for that style.

Good commit subjects:

- `feat(search): add saved filter presets`
- `fix(api): handle empty webhook payloads`
- `refactor(cache): simplify invalidation flow`
- `chore: update local development tooling`

## Stage And Commit

Once the message is ready, include the entire working tree in the commit.

- Stage everything with `git add -A`.
- Re-check with `git status --short` if needed to confirm the index matches expectations.
- Do not run tests, builds, or other validation steps as part of this skill. Assume those checks already happened before `cc` was issued.
- Commit with `git commit -m "<type>(<scope>): <summary>"` or `git commit -m "<type>: <summary>"`.

## Edge Cases

- If `git commit` fails because hooks reject the changes, report the failure clearly and include the hook output.
- If the repository is in the middle of a merge, rebase, or cherry-pick, stop and explain that the user should decide whether to finish or abort that operation first.
- If the change set obviously contains unrelated work that should not be grouped together, pause and ask before committing.
