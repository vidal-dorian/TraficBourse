---
name: dev-us
description: Develop one user story of Cockpit from start to pull request. Use when the user asks to develop a story, or sends a message like "/dev-us 42 --branch us/42-short-title".
---

# Develop a user story

The message is `/dev-us <story_id> [--branch <name>] [--team <name>] [--launch <id>] [--night]`, then an optional extra prompt that you follow too. You build the story on its own branch, with the agents of the repository, and open a pull request. You never merge it.

The Cockpit tools are named `mcp__cockpit__<tool>`. If they are not available, the `cockpit` MCP server is not connected: tell the user and stop.

## Before you start

If a check fails, stop and say why. Change nothing.

1. **The folder.** The current folder must be the repository of the story's project: compare `git remote get-url origin` with the `full_name` of the project (step 2).
2. **The story.** Call `mcp__cockpit__get_user_story` with the `story_id`. Develop only a story whose status is `ready` or `in_review`, and refuse any other: a story the user validated is developed, and one in review is taken up again on its branch. Tell the user its status. Also refuse an archived project. Read the narrative, the notes, every criterion and the `depends_on` stories (a dependency that is not done is worth a warning, not a stop).
3. **The working tree.** `git status --porcelain` must print nothing: the working tree must be clean.
4. **The default branch.** Take `default_branch` from the project, then `git fetch origin` and bring that branch up to date (fast-forward only).
5. **The team.** With `--team <name>`, the name is made of `a-z`, `0-9` and `-` only, and `.claude/teams/<name>.md` must exist on that branch: if it does not exist, stop and say so, never fall back to the default team.

## The branch

- With `--branch <name>`: if the branch exists on `origin`, check it out and update it (`git pull --ff-only`): the story is resumed. Otherwise create it from the default branch and push it with `git push -u origin <name>`.
- Without `--branch`, if the story already has a `branch` (from `get_user_story`), use it as if it were given with `--branch`. Otherwise name it `us/<story_id>-<short-title>`, the title taken from `i_want`: lower case, no accents, words joined by dashes, 40 characters at most. Create it and push it the same way.

## Start the run

Once the branch is ready, call `mcp__cockpit__start_run` with the `story_id`, the branch name and the model of this session. Keep its `run_id`: the user follows the run live in Cockpit. If it is refused, stop and say why. If the user gave an extra prompt after the options, pass it to `start_run` as `comment`. With `--launch <id>`, pass the value as it is to `start_run` in `launch_id`. Pass the `steps` too: the agents you will run (see Develop), in order, once per step (a loop is not unrolled), so that the user sees the steps to come. Read the team before you start the run for that.

From now on, whenever you stop before the pull request is linked with `link_pull_request` (a refused tool, a step that fails for good, a test you must not change), first call `mcp__cockpit__finish_run` with `outcome` `failed` and the reason in the `summary`: otherwise the story stays "in progress" and cannot be started again.

## Develop

Read `CLAUDE.md` first: it holds the commands and the conventions. Then run the steps in order, never starting a step before the previous one is done.

Without `--team`, if `.claude/team.md` exists, its steps are the ones to follow. Its front matter lists them, each naming an `agent` of `.claude/agents/` and saying what it `does`:

```
---
steps:
  - agent: doc-writer
    does: writes the documentation
---
```

A step with `loop_to` and `until` sends you back to that step until the condition holds. With `--team <name>`, the steps are those of `.claude/teams/<name>.md`, in the same format. Without `--team`, and without `.claude/team.md`, the default steps are these three, in this order:

1. **test-writer** writes the acceptance tests from the criteria. They must fail, for the right reason.
2. **developer** implements until those tests pass, without touching them.
3. **reviewer** reviews the diff with a fresh context. Blocking findings go back to the developer, then to a new review, until the verdict is **ready**.

A step can also carry these keys, all optional:

- `id` names the step when its agent is in the team twice (the same format as an agent name). The key of a step is its `id`, or its `agent` without one, and `loop_to` names a key.
- `parallel: true` runs the step at the same time as the step before it. A step followed by `parallel: true` steps and those steps are a group. Start the steps of a group at the same time, each one by a sub-agent in its own git worktree, on a branch taken from the branch of the story. With `wait: all` or no `wait` (on the first step of the group), wait until all of them have finished, then merge each branch into the branch of the story. With `wait: first`, the first step to finish is merged, the other steps are stopped and their work is discarded (abandoned). When a merge conflicts, call `mcp__cockpit__ask_user` with what is in conflict in the `context`, and wait for the answer before going on.
- `max` (1 to 9, with `loop_to`) is the most times the loop is followed. Follow the loop while `until` is not true and `max` is not reached; at the limit, stop and call `mcp__cockpit__ask_user` (the question is whether to go on or to stop). With `until: always`, the loop is followed exactly `max` times, and reaching the limit is not a problem: go on with the next step. A loop into a step of a group redoes only that step, then goes on after its group.

An agent in two steps is given twice in the `steps` of `mcp__cockpit__start_run`, in order. A loop without `max` is followed until `until` holds, as before.

An agent can be any of `.claude/agents/`: the **security-reviewer** as a step reviews the diff of the story for security and gives a verdict like the reviewer (its blocking findings go back to the developer until the verdict is **ready**, it files no finding), and the **doc-writer** and **doc-reviewer** steps update the documentation (the doc-reviewer's blocking findings go back to the doc-writer).

### Freeze mode

When `get_user_story` gives `kind` `takeover`, the story is an existing app being frozen, not a feature to build: its criteria are the rules of the app as it is. Whatever the team, change the steps this way:

- Run only two steps, in this order: the **test-writer**, then the **reviewer**. Skip the **developer** and every other step of the team (a `doc-writer` too): there is nothing to implement or document.
- **test-writer** writes one test per rule (per criterion). Each test must pass at once, without changing app code: no file of the app is modified.
- A rule whose test fails on the code as it is stays out of the PR: do not commit that test, so the CI does not stay red for nothing. The test-writer gives you its name and what it gives instead of calling `report_criterion`: you report the criterion as `failed` in the Finish step. The tests that pass go into the PR all the same. When every rule fails there is nothing to commit: open no PR, report every criterion `failed`, and finish the run `failed` with that reason.
- **reviewer** checks that each test states its rule and that the PR does not change the app code. Its blocking findings go back to the **test-writer**, never to a developer, until the verdict is **ready**. A change to the configuration of the tests or to a manifest is not blocking: it names it in its summary, for the human.

For a freeze run the `steps` are the two freeze steps, `test-writer` then `reviewer`.

Before each step call `mcp__cockpit__report_step` with the `run_id`, the `agent` and the event `started`; after it, with the event `finished`, its `status` (`succeeded` or `failed`) and a short `summary`. A step you redo (the review loop) is reported `started` again.

When `report_step` or `get_answer` answers `stop_requested: true`, the user asked to stop: call `mcp__cockpit__finish_run` with `outcome` `failed` and the `summary` « Arrêt demandé par l'utilisateur » (the user reads it in Cockpit), then stop, pushing nothing more.

When a choice belongs to the user (a name, a trade-off, a scope you cannot settle from the story and the notes), never guess: call `mcp__cockpit__ask_user` with the `run_id`, the question, a `context` (1 to 1,000 characters: what is done so far and what the answer decides, which the user reads as « why Claude asks »), plus at most two `suggested_answers` when the choices are obvious. It answers at once. Keep working on what does not depend on the answer, then call `mcp__cockpit__get_answer` with the `question_id` after 30 seconds, after 1 minute, after 2 minutes, then every 5 minutes (each call is journaled: never poll faster). Resume with the answer as soon as `answered` is true.

Give each agent the story, its criteria and the notes. Commit as you go, in small commits that follow the conventions of the repository.

## At night (`--night`)

With `--night`, nobody is there to answer: never wait for an answer. When a choice belongs to the user, call `mcp__cockpit__ask_user` as above, then do not poll `get_answer`. Commit and push what is done on the branch (push only to the branch of the run), call `mcp__cockpit__finish_run` with `outcome` `paused` and a `summary` of what is done and what the question blocks, and stop. Cockpit relaunches the story on the same branch, by day, with the question and the answer as the extra prompt. A run that needs no question finishes as usual.

## Finish

1. Run **all the tests**, the lint and the type check of the repository (the commands are in `CLAUDE.md`). Everything must pass: fix, never skip or disable.
2. Call `mcp__cockpit__report_criterion` once per criterion of the story, with `result` `passed` or `failed` and as `evidence` the test that proves it (file and test name) or what fails (for a rule of a `takeover` story whose test failed: the test and what it gave).
3. Push the branch.
4. If the story already had a `pr_number` when you read it before starting, do not open a new pull request: the push of step 3 updates the one of the story, so go to step 5 with the `pr_number` of the story. Otherwise open the pull request against the default branch (`gh pr create`), in the language of the repository's conventions: a title that says what the story does, a body that lists each criterion with the test that proves it, anything left undone, and the line `Closes #<issue>`, where `<issue>` is the GitHub issue of the story (find it with `gh issue list --search "<i_want>"`; if you cannot tell which one it is, ask the user).
5. Call `mcp__cockpit__link_pull_request` with the `run_id` and the number of the pull request you just opened (or the story's `pr_number`).
6. Call `mcp__cockpit__finish_run` with `outcome` `succeeded` and a `summary` of the work.
7. Tell the user the link of the pull request, and what you are unsure about.

## Never

- Never merge the pull request, never push to the default branch, never force-push.
- Never change an acceptance test to make it pass: if a test is wrong, stop and tell the user.
- Never put secrets or personal data in a commit, a pull request or a message.
