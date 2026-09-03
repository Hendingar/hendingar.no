---
name: ship
description: The end-to-end workflow for one piece of work on hendingar.no — branch from main, verify, open a PR, merge it on green, and delete the branch. Use this for EVERY change that touches the repo, from a one-line copy fix to a new importer. Also covers rebasing when two PRs collide, and how to leave no dangling branches.
---

# Shipping one piece of work

Every change lands the same way: **one branch → one PR → merged on green → branch deleted.**
Nothing is "done" while it sits on a local branch, and nothing is merged that `pnpm verify` has
not passed.

Work in this repo is authorised to merge without asking. That makes the discipline below the only
thing standing between a green build and a broken `main`.

## 1. Branch from `origin/main`. Always.

```bash
git fetch origin --quiet
git checkout -b <type>/<short-name> origin/main
```

`feat/`, `fix/`, `chore/`, `docs/`. **Never branch off another unmerged branch.** PRs here are
squash-merged, which makes a brand-new commit that shares no history with the branch it came from
— so a stacked branch conflicts against every file the parent touched the moment the parent lands.
If two pieces of work genuinely depend on each other, finish and merge the first.

## 2. Do the work, then prove it

```bash
pnpm verify        # typecheck (incl. svelte-check) → lint → test
```

`pnpm verify` does not see `services/verifier` — that is Python:

```bash
cd services/verifier && ruff check . && ruff format --check . && pytest -q
```

**A passing subset is not evidence.** If `verify` fails you are not done, no matter how right the
change looks.

### If the change touches the UI, run the e2e specs — against the database CI actually uses

`pnpm test:e2e` reads whatever is in your local database, and CI seeds a specific one. Running the
specs against a database you have ingested into produces failures that are pure noise, and — worse
— hides real ones. Reproduce CI exactly:

```bash
pnpm db:reset && pnpm db:seed && pnpm db:sources && pnpm consolidate && pnpm test:e2e
```

All four steps. `db:sources` registers the link-only sources and `consolidate` marks cross-source
duplicates; without them a handful of specs fail while passing on a laptop where someone ran them
by hand.

Afterwards, `pnpm db:bootstrap` puts the realistic data back.

### Prove a new guard actually bites

A test that passes is not yet a test that works. When you add or rewrite an assertion, break the
thing it guards, watch it fail, then put it back:

```bash
# e.g. revert the CSS fix, or re-add the claim the spec forbids
pnpm --filter @hendingar/app exec playwright test -g "<spec name>"
```

This has caught two specs that had been passing for months against data that could not fail them.

## 3. Commit and open the PR

Commit messages and PR bodies explain **why**, and name what the source or the code made you
decide. A reviewer reading it later should not have to re-derive the reasoning.

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

```bash
git push -u origin <branch>
gh pr create --title "…" --body "…"      # end the body with the Claude Code footer
```

State what you actually verified — counts, a second idempotent run, "56 e2e pass" — not "should
work".

## 4. Merge on green — hand it to GitHub, not to yourself

Arm server-side auto-merge the moment the PR exists:

```bash
gh pr merge <N> --squash --delete-branch --auto
```

`--auto` is the whole point. GitHub merges the PR itself when the checks pass, whether or not this
session is still alive, still watching, or still in the same conversation. `allow_auto_merge` and
`delete_branch_on_merge` are enabled on the repo, so the branch is deleted either way.

If the checks are already green, the same command merges immediately.

**Do not use a background Monitor to merge a PR.** It was tried and it silently did not fire —
three PRs sat green and unmerged while the session reported them as "auto-merging". A watcher that
merges is a promise that depends on the watcher still running, which is not something to promise.

### Never say "merged" without looking

The failure above was not the monitor, it was reporting an intention as an outcome. Before telling
anyone a PR is merged:

```bash
gh pr list --state open --json number,title      # expect: not this one
git branch -r | grep -v HEAD                     # expect: only origin/main
```

If a check is red, say so and fix it. "It should merge shortly" is not a status.

## 5. Prune locally

```bash
git checkout main && git fetch origin --prune && git reset --hard origin/main
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D
```

## When two PRs collide

They will, whenever both add an importer: both edit the same line of `package.json` and insert a
step at the same anchor in `.github/workflows/ingest.yml`. After the first merges:

```bash
git checkout <branch> && git rebase origin/main
```

**Resolve conflicts by hand, and never with a regex over the conflict markers.** A pattern that
keeps "both sides" interleaved two workflow steps into one broken step — `- name: Ingest DNT`
immediately followed by `- name: Ingest HVL`, with DNT's `else` branch running the other importer.
YAML that still parses, doing the wrong thing.

For two additive lists the resolution is nearly always *both*, in order. Then check the result is
only what you meant to add:

```bash
git diff origin/main -- <the conflicted file>
pnpm verify
git push --force-with-lease
```

`--force-with-lease`, never `--force`.

## Before you say it is shipped

- [ ] `pnpm verify` exits 0
- [ ] e2e run against the CI database state, if the UI changed
- [ ] any new guard proven to fail when the thing it guards is broken
- [ ] PR actually merged — confirmed with `gh pr list --state open`, not assumed
- [ ] branch gone from the remote, local branches pruned
- [ ] for a new importer: it appears in `pnpm ingest`, in `.github/workflows/ingest.yml`, and a
      second run reports every row `unchanged`

## What this does NOT cover

Deploying and ingesting are automatic and are not yours to trigger:

- **Deploy** runs on merge to `main`.
- **Ingest** runs on a daily `cron` and writes to the live database.

A deploy ships *code*, not data — so a newly merged importer imports nothing until the next
scheduled ingest, or a manual `gh workflow run ingest.yml`. Say that plainly rather than implying
the events are already live.
