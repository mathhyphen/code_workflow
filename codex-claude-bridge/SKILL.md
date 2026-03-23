---
name: codex-claude-bridge
description: Use when the user wants a fully local Codex-planner plus Claude-Code-executor workflow, bridged through a local MCP server and JSON-RPC queue. This skill is for setting up, operating, or extending an AgentBridge-style handoff loop between Codex and Claude Code.
---

# Codex Claude Bridge

Use this skill when the task is to run Codex as the planner and Claude Code as the execution worker inside a local, self-hosted loop.

## What this skill assumes

- A local AgentBridge harness exists or should be created.
- The planner side will enqueue tasks and read results through a local JSON-RPC API.
- Claude can be used in one of two ways:
  - automatic managed-worker mode, where AgentBridge launches `claude -p` on demand,
  - optional manual MCP mode, where Claude Code connects to the queue through an MCP stdio adapter.

## Workflow

1. Confirm whether a local bridge already exists.
2. If it does not exist, create a minimal harness with:
   - a persistent task queue,
   - a local JSON-RPC endpoint for the planner side,
   - a managed Claude worker launcher,
   - and optionally an MCP adapter for manual Claude sessions.
3. Keep the harness local-first. Do not introduce GitHub Actions, webhooks, or third-party queues unless the user explicitly asks for them.
4. Treat Codex as the planner:
   - break work into explicit tasks,
   - enqueue title, description, repo path, commands, and acceptance criteria,
   - wait for results before revising the plan.
5. Treat Claude Code as the executor:
   - in automatic mode, let AgentBridge launch Claude per task and capture its report,
   - in manual mode, let Claude pull one task at a time over MCP,
   - in both cases, run relevant checks and record status, summary, logs, and artifact paths.

## Operating guidance

- Prefer a single bridge process that exposes MCP on stdio and JSON-RPC over localhost.
- If you support both daemon and MCP mode, split them into separate entrypoints so the daemon owns the HTTP port and the MCP adapter stays stdio-only.
- Log to stderr or files, never stdout, because MCP stdio must stay clean.
- Persist state to disk so the queue survives restarts.
- Keep tools narrow and mechanical. The planner should decide what to do; the bridge should only move tasks and results.
- If you need concrete prompt shapes or payload examples, read [references/operation.md](references/operation.md).

## Deliverables to produce

When asked to implement this workflow, prefer shipping:

- a runnable bridge,
- one example Claude MCP config,
- one planner example for enqueuing tasks,
- one smoke test,
- concise instructions for running the loop locally.
