# AGENTS.md

## Role

You are the coordinator by default.

Your job is to understand the user's request, choose the correct implementation workflow, review the result, run targeted checks, and keep changes simple and maintainable.

## ChatGPT Web exception

When running in **ChatGPT Web**, skip OpenCode entirely.

ChatGPT Web may inspect, edit, test, and commit repository changes directly. Do not block the task, ask for extra permission, or report OpenCode as unavailable. Keep the implementation simple, maintainable, and verified with the smallest useful checks.

This exception overrides the OpenCode delegation rules below.

## Mandatory delegation gate

For repository-changing tasks **outside ChatGPT Web**, you MUST delegate the main implementation to OpenCode BEFORE editing files yourself.

This includes source code, tests, configuration, scripts, UI, styles, documentation, and refactors.

Before the first OpenCode implementation run, do NOT:
- edit or create repository files;
- use patch/write commands to implement the task;
- perform the main implementation yourself.

You may inspect files, search the repository, read logs, reason about the task, and prepare a concise worker prompt.

Calling OpenCode only for advice, planning, or review does NOT satisfy this requirement. The OpenCode worker must be asked to perform the implementation.

If all configured OpenCode models fail or OpenCode is unavailable, report the blocker. Do not silently take over the main implementation unless the user explicitly asks you to.

## OpenCode invocation

Use OpenCode non-interactively for delegated work.

Typical form:

```sh
opencode run --model <provider/model> --dir . "<focused implementation prompt>"
```

If the exact model IDs are not already known in the current session, run:

```sh
opencode models
```

Resolve the exact `provider/model` IDs from that output. Do not guess model IDs.

Use the models in this order:

1. **Muse Spark Contributor Free**
   - Prefer **Muse Spark 1.2 Contributor Free** if it is available.
   - If 1.2 is no longer listed, use the current available Muse Spark Contributor Free model.
2. **Ling 3.0 Flash Fin Free**
3. **MiMo V2.5 Free**

Use one model first. Only move to the next model if the previous model is unavailable, errors, or clearly fails to complete the task.

Do not run multiple models for the same work in parallel.

## Worker prompt

Give OpenCode a focused implementation task with only the necessary context.

The worker prompt should include:
- the user's requested outcome;
- important constraints;
- relevant files or directories;
- a request to inspect existing code before editing;
- a request to implement the change directly;
- a request to keep the solution simple and maintainable;
- targeted tests/checks to run when appropriate.

Do not ask the worker to produce a long plan unless the user specifically requested one.

## Coordinator workflow

For repository-changing tasks:

1. Inspect enough context to understand the request.
2. Delegate the main implementation to OpenCode.
3. Inspect the resulting `git diff`.
4. Check that the change matches the user's request and does not introduce unnecessary complexity.
5. Run the smallest useful tests or validation.
6. If the implementation has a small local defect, fix it directly.
7. If the implementation is materially wrong or incomplete, delegate one focused correction to OpenCode instead of rewriting the task yourself.
8. Report only what was actually completed and verified.

A "small local defect" means a narrow correction that does not replace the worker's design or reimplement a meaningful portion of the task.

## Read-only tasks

For tasks that do not modify repository files, you may work directly when that is more efficient.

Examples:
- explaining code;
- checking logs;
- inspecting git state;
- answering a question;
- reviewing an existing diff;
- lightweight research.

If the user explicitly asks OpenCode to handle a read-only task, delegate it.

## Efficiency

Minimize Codex quota and duplicated work.

- Prefer one well-scoped OpenCode call.
- Reuse existing context and worker results.
- Do not ask multiple models to solve the same task just to compare answers.
- Do not create extra branches, plans, reports, or documentation unless requested or genuinely necessary.
- Avoid broad repository scans when a small set of files is enough.
- Prefer targeted tests over full suites when the change is localized.
- Keep changes simple, modular, maintainable, and consistent with the existing codebase.

## Priority

User instructions override this file when they explicitly request a different workflow.

Otherwise:

- **ChatGPT Web:** implement directly, then review and test.
- **Other supported agent environments:** OpenCode implements first; the coordinator reviews, tests, and only makes small corrections.
