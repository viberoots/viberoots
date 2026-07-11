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
5. For viberoots consumer repositories, confirm the viberoots submodule gitlink and root
   `flake.lock` metadata point at the same viberoots revision before staging.
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
- After the submodule commit exists, return to the parent repository and stage the updated submodule
  gitlink along with any parent-repo changes.
- Do not commit the parent repo pointer while the submodule still has uncommitted local changes,
  unless the user explicitly asks to leave those submodule changes uncommitted.

## Sync Viberoots Pins

Before staging a commit in a viberoots consumer repository, make sure checked-in viberoots pins are
coherent. This prevents committing only the submodule gitlink and leaving root flake metadata to
change on the user's next `viberoots update`.

Treat a repository as a viberoots consumer when it has a `viberoots` submodule or a `.viberoots`
workspace directory. In that case:

- If both `viberoots/` and root `flake.lock` exist, compare the submodule revision with the
  root lockfile's `nodes.viberoots.locked.rev`.
- Use a structured parser, for example:

  ```sh
  submodule_rev="$(git -C viberoots rev-parse HEAD)"
  lock_rev="$(jq -r '.nodes.viberoots.locked.rev // empty' flake.lock)"
  ```

- If both values are present and differ, run the repo's normal pin-sync path, usually
  `viberoots update`, then inspect the resulting diff and include the updated `flake.lock` in the
  same parent commit.
- Re-check the revisions after syncing. Do not commit if the values still differ or if the sync
  command failed.
- If the repository has only flake-mode viberoots metadata and no `viberoots/` submodule, do not
  invent a submodule check; commit the existing flake changes as part of the normal change set.
- If the repository has a viberoots submodule but no root `flake.lock`, no flake metadata sync is
  needed.

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
