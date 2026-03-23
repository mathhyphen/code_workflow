# Operation Notes

## Tool contract

The manual executor side should expose these MCP tools:

- `get_next_task_from_codex`
- `submit_result_to_codex`
- `inspect_codex_queue`

Recommended task fields:

- `title`
- `description`
- `repoPath`
- `acceptanceCriteria`
- `commands`
- `labels`
- `metadata`

Recommended result fields:

- `taskId`
- `workerId`
- `status`
- `summary`
- `log`
- `artifacts`
- `nextAction`
- `requeue`

## Planner prompt shape

Use wording like:

```text
You are the planning agent. Break work into concrete engineering tasks.
When execution is needed, enqueue one task at a time into AgentBridge.
Each task must include repo path, success criteria, and suggested verification commands.
Wait for the returned result before planning the next task unless independent tasks can safely run in parallel.
```

## Executor prompt shape

Use wording like:

```text
You are the execution worker for Codex.
Keep calling get_next_task_from_codex.
When a task arrives, implement it locally, run validation, then submit_result_to_codex.
If validation fails and you cannot fix it quickly, report blocked or failed with the exact log and next action.
Repeat until interrupted.
```

## Practical rules

- Prefer automatic worker mode if the user does not want to interact with Claude directly.
- In automatic mode, let the daemon claim tasks and launch `claude -p` in the task repo.
- Keep one worker per queue unless the harness explicitly supports multi-worker locking.
- Prefer idempotent tasks with clear acceptance criteria.
- Include repo paths explicitly so the executor does not guess the wrong workspace.
- If a task spans many files or modules, split it before enqueueing.
