# Codex + Claude Code Local Workflow

This repository now contains a local harness for the architecture you described:

- `agentbridge/`: the runnable daemon plus worker launcher
- `codex-claude-bridge/`: a reusable skill definition
- `docs/claude-code-mcp.config.example.json`: Claude Code MCP example

## What AgentBridge does

`AgentBridge` now has two runtime modes:

1. A daemon over local HTTP for Codex, scripts, and queue persistence.
2. An optional MCP stdio adapter for manual Claude Code connections.
3. An optional managed Claude worker that the daemon can launch for you automatically.

That split matters because it avoids port conflicts. The daemon owns the queue; the MCP adapter is just a thin client that talks back to the daemon.

If you use the manual Claude MCP mode, Claude Code gets three tools:

- `get_next_task_from_codex`
- `submit_result_to_codex`
- `inspect_codex_queue`

The HTTP JSON-RPC API exposes:

- `bridge_health`
- `enqueue_task`
- `list_tasks`
- `peek_next_task`
- `claim_task`
- `submit_result`
- `list_results`
- `queue_snapshot`
- `worker_status`
- `worker_start`
- `worker_stop`

## Quick start

### Mode A: hands-off automatic Claude worker

This is the mode you asked for if you only want to interact with Codex.

1. Install dependencies once:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
npm install
```

2. Run the smoke test:

```powershell
npm run smoke
```

3. Start the bridge:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
npm start
```

You can also use the one-command helper instead:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
npm run stack
```

If you want to initialize a repo's loop files before the first task, run:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
npm run init-loop -- D:\apps\my_experiment_project
```

4. Start the managed Claude worker once:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
node scripts/rpc-call.js worker_start
```

5. Push a task into the queue from Codex, PowerShell, or any planner script:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
node scripts/rpc-call.js enqueue_task "{\"title\":\"Build preprocess.py\",\"description\":\"Create a preprocessing script for multimodal data.\",\"repoPath\":\"D:/apps/my_project\",\"acceptanceCriteria\":[\"Script runs on sample input\",\"Document any missing dependency\"],\"commands\":[\"python preprocess.py --help\"]}"
```

Once the worker is running, the daemon will automatically claim queued tasks and launch `claude -p` for each one. You do not need to talk to Claude Code directly.

6. Check status whenever you want:

```powershell
node scripts/rpc-call.js worker_status
node scripts/rpc-call.js queue_snapshot "{\"limit\":10}"
```

7. If you want a simpler Codex-side handoff, use the helper that ensures the stack is up and enqueues the task in one shot:

```powershell
Set-Location D:\apps\code_workflow\agentbridge
node scripts/delegate-task.js "{\"title\":\"Implement parser\",\"description\":\"Complete the parser task in the repo and run relevant checks.\",\"repoPath\":\"D:/apps/my_project\",\"acceptanceCriteria\":[\"Parser works\",\"Checks pass\"],\"commands\":[\"npm test\"]}"
```

8. If you want Claude to follow your own coding skill or runbook, pass it through `metadata.skillFiles` and optionally `metadata.skillPrompt`:

```json
{
  "title": "Implement parser",
  "description": "Complete the parser task in the repo and run relevant checks.",
  "repoPath": "D:/apps/my_project",
  "acceptanceCriteria": [
    "Parser works",
    "Checks pass"
  ],
  "commands": [
    "npm test"
  ],
  "metadata": {
    "skillFiles": [
      "D:/my-skills/backend-rules.md",
      ".agentbridge/team-style.md"
    ],
    "skillPrompt": "Follow the backend rules strictly. Prefer the existing service-layer patterns."
  }
}
```

When `metadata.skillFiles` is present, the worker tells Claude to read those files before changing code.

If you want the worker to auto-start every time the daemon boots, set `AGENTBRIDGE_AUTO_START_CLAUDE=true` in your environment before running `npm start`.

Ready-to-copy templates:

- [experiment-task.example.json](/D:/apps/code_workflow/docs/templates/experiment-task.example.json)
- [research-plan.example.md](/D:/apps/code_workflow/docs/templates/research-plan.example.md)

### Mode B: optional manual Claude MCP mode

If you still want a standalone Claude Code session connected to the queue, point it at the MCP adapter using [claude-code-mcp.config.example.json](/D:/apps/code_workflow/docs/claude-code-mcp.config.example.json).

## Managed worker behavior

The automatic worker loop is:

1. daemon claims the next queued task,
2. daemon prepares a `.agentbridge/` memory directory inside the target repo,
3. daemon launches `claude -p` in the task repo,
4. Claude reads and updates the memory files while editing code and running checks,
5. daemon parses Claude's final report and stores the result.

This means your normal control surface is just the queue API. Codex can enqueue work; the daemon handles the Claude side.

## Repository memory files

For each target repo, AgentBridge maintains:

- `.agentbridge/project-memory.md`: durable project facts, conventions, architecture notes, and known risks
- `.agentbridge/current-task.md`: the currently assigned task or the last completed task summary
- `.agentbridge/task-history.md`: compact execution history across tasks
- `.agentbridge/planner-inbox.md`: the first file Codex should read after an execution run
- `.agentbridge/research-plan.md`: the planner-owned strategy file for the next research cycle
- `reports/execution/`: one markdown execution report per run, written for Codex to consume next

This is the main safeguard against context exhaustion. Each new Claude run starts fresh, then rebuilds context from repository files instead of relying on a long-running chat session.

Suggested operating loop:

1. Codex reads `.agentbridge/planner-inbox.md`, `.agentbridge/research-plan.md`, and the latest file in `reports/execution/`.
2. Codex updates the research strategy and creates the next execution task.
3. AgentBridge dispatches that task to Claude.
4. Claude writes code, runs experiments, updates the memory files, and AgentBridge writes a standard execution report.
5. Codex reads the new report and repeats.

## Manual Claude executor prompt

Use a prompt along these lines in Claude Code after MCP is connected:

```text
You are the execution worker for Codex.
Loop forever:
1. Call get_next_task_from_codex with workerId="claude-code".
2. If task is null, wait and try again.
3. Implement the task in the local workspace.
4. Run the most relevant verification commands.
5. Call submit_result_to_codex with status, summary, log, and any artifact paths.
6. Repeat.
Do not stop unless the user explicitly interrupts you.
```

## Codex planner pattern

From Codex or a local planning script, enqueue work with JSON-RPC and later read results:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/rpc -ContentType 'application/json' -Body (@{
  jsonrpc = '2.0'
  id = 'enqueue-1'
  method = 'enqueue_task'
  params = @{
    title = 'Implement parser'
    description = 'Add parser.ts and verify edge cases.'
    repoPath = 'D:/apps/my_project'
    acceptanceCriteria = @('All tests pass', 'Parser handles empty input')
    commands = @('npm test')
    labels = @('parser', 'high-priority')
  }
} | ConvertTo-Json -Depth 8)
```

Read recent results:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/rpc -ContentType 'application/json' -Body (@{
  jsonrpc = '2.0'
  id = 'results-1'
  method = 'list_results'
  params = @{
    limit = 10
  }
} | ConvertTo-Json -Depth 8)
```

Start the automatic worker through JSON-RPC:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/rpc -ContentType 'application/json' -Body (@{
  jsonrpc = '2.0'
  id = 'worker-start-1'
  method = 'worker_start'
  params = @{}
} | ConvertTo-Json -Depth 8)
```

## State model

Each task records:

- title, description, repoPath
- acceptanceCriteria, commands, labels, metadata
- status: `queued`, `in_progress`, `completed`, `failed`, or `blocked`
- claimed worker, timestamps, and latest result id

Useful metadata keys:

- `metadata.skillFiles`: absolute paths or repo-relative paths to skill/runbook markdown files Claude must read first
- `metadata.skillPrompt`: short inline guidance that reinforces how those skills should be applied

Each result records:

- task id
- worker id
- status: `success`, `failed`, or `blocked`
- summary
- optional terminal log
- optional artifact list
- optional next action

## Suggested next step

If you want to turn this into a fuller planner loop, the next layer is a small Codex-side script that:

1. reads open planning items,
2. enqueues them into AgentBridge,
3. polls `list_results`,
4. summarizes the returned outcomes into a report.
