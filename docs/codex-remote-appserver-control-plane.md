# Codex Remote App Server Control Plane

This document describes a standalone control plane for the workflow where:

- each remote machine runs its own Codex App Server
- your local machine acts as the controller
- projects stay on the server that owns them
- the local side only catalogs targets, opens threads, and tracks sessions

This is intentionally separate from `agentbridge` and from the Codex-to-Claude workflow in this repository.

## What This Is

The goal is to manage many remote Codex environments from one local place without turning the local machine into the execution host.

That means the local control plane should:

- remember remote targets and their default project settings
- connect to one target at a time over WebSocket
- initialize a Codex App Server session
- start a thread in a specific project directory
- send additional turns into an existing thread
- read thread history and keep a local session index

It should not:

- manage Claude Code workers
- own a task queue for execution handoff
- depend on `agentbridge`
- assume all projects live in one workspace

## When This Fits

This model fits best when:

- the codebase is large enough that it should stay on a server
- each server has enough CPU, RAM, disk, or GPU resources to run Codex comfortably
- you want the local machine to be a thin control surface
- you need to switch between many servers or many isolated projects

It is a good fit for the pattern you described earlier: the local app is the console, while the remote servers are where the real work happens.

## Target Model

Each remote target is one Codex App Server endpoint plus some default metadata for one project or project group.

Recommended fields:

- `id`: stable local identifier
- `label`: human-readable name
- `url`: remote App Server WebSocket URL as seen from the server, usually `ws://127.0.0.1:<port>`
- `defaultCwd`: default project directory on that server
- `defaultModel`: default model to use for that target
- `defaultApprovalPolicy`: default approval policy to send when starting a thread or turn
- `defaultSandbox`: default sandbox setting for that target
- `sshEnabled`: optional flag for built-in SSH forwarding
- `sshHost`: SSH hostname for the server
- `sshPort`: optional SSH port
- `sshUser`: optional SSH username
- `sshLocalPort`: optional fixed local forward port
- `sshIdentityFile`: optional SSH private key path on the local controller
- `notes`: optional free-form operator note

One target can represent:

- one project on one server
- many projects on the same server, if you control them by changing `cwd`
- one tunnel endpoint that forwards to one server-local App Server

## Recommended Topology

The safest and simplest topology is:

1. Run `codex app-server` on the server, bound to `127.0.0.1`.
2. Store that server-local URL in the target, for example `ws://127.0.0.1:4500`.
3. If `sshEnabled` is on, let the control plane open the local SSH forward automatically.
4. Start threads per project using the remote `cwd`.

That keeps the App Server off the public internet and avoids building your own auth layer too early.

Example target:

```json
{
  "id": "srv-a-proj1",
  "label": "Server A / proj1",
  "url": "ws://127.0.0.1:4500",
  "defaultCwd": "/srv/projects/proj1",
  "defaultModel": "gpt-5.4",
  "defaultApprovalPolicy": "never",
  "defaultSandbox": "workspace-write",
  "sshEnabled": true,
  "sshHost": "server-a.example.com",
  "sshPort": "22",
  "sshUser": "ubuntu",
  "sshLocalPort": "4501",
  "notes": "The control plane opens the SSH tunnel locally."
}
```

## Core Flow

The local controller talks to the remote App Server in this order:

1. `initialize`
2. `thread/start`
3. `turn/start`
4. `thread/read`
5. repeat `turn/start` as needed

For a thread that is already in progress, you can resume with:

1. reconnect to the target
2. read the thread
3. append a new turn
4. wait for the completion notification or completion result

The local side should store the following for convenience:

- target id
- thread id
- current project path
- last turn id
- last assistant message
- timestamps for the most recent update

## Minimal Operations

The first version of the control plane only needs a small set of operations:

- `target_upsert`
- `target_list`
- `target_remove`
- `target_connect`
- `target_disconnect`
- `target_probe`
- `tunnel_list`
- `thread_start`
- `turn_start`
- `thread_read`
- `thread_list`
- `session_list`

That is enough to cover the practical operator loop:

- register a server
- confirm the server is reachable
- start work on a project
- continue the thread later
- inspect what happened

## Built-In Web Panel

The standalone `remote-control-plane` can expose a small local web panel on the same machine as the controller. This is a built-in operator UI, not a separate product layer and not a dependency on `agentbridge`.

When the control plane is running locally, open:

```text
http://127.0.0.1:8876/
```

Or replace `8876` with your `CODEX_CONTROL_PORT` value.

The web panel should stay local-first:

- bind only to `127.0.0.1` by default
- read and write through the same local control-plane RPC service
- avoid reaching directly into remote servers from the browser
- keep the remote App Server connection logic inside the control plane process

The panel is meant to make the standalone workflow easier to use without changing the architecture. It should give you a single place to:

- register and edit remote targets
- probe connectivity to a target
- open a new thread on a server/project pair
- continue an existing thread
- inspect recent sessions and last assistant output
- see the current target, thread, and turn status

Suggested screens:

- `Targets`: list targets, add a target, edit target defaults, remove a target
- `Sessions`: show recent remote threads, grouped by target
- `Thread`: show the current thread, the latest turn, and the most recent assistant message
- `Log`: show control-plane events, connection failures, and turn completion state

Suggested panel actions:

- `Probe target`
- `Start thread`
- `Send turn`
- `Refresh thread`
- `Open session`

If we later add richer UI features, they should still be treated as a local shell around the standalone control plane:

- filters and search across targets
- streaming turn output
- approval-state badges
- lightweight diff or artifact previews

The key boundary stays the same: the browser UI is just the operator surface, while the control plane owns the actual WebSocket session to the remote Codex App Server.

## What A Session Looks Like

A session is the local memory of a remote thread.

Typical session fields:

- `targetId`
- `threadId`
- `cwd`
- `model`
- `status`
- `lastTurnId`
- `lastTurnStatus`
- `lastAssistantMessage`
- `updatedAt`

This is not the same thing as the remote thread itself.

The remote thread is owned by Codex App Server on the target machine. The local session is just your operator index.

## Security Notes

Treat the WebSocket endpoint as sensitive.

Prefer:

- SSH tunnels
- VPN access
- local-only binding on the remote host

Avoid:

- exposing `ws://` directly to the public internet
- mixing control-plane traffic with unrelated app traffic
- storing server credentials in the target catalog

If you later want stronger access control, add it at the transport layer first.

## Implementation Boundary

This branch should stay separate from `agentbridge`.

That means:

- separate package or module
- separate state file
- separate docs
- separate target catalog

The point is to make the remote App Server workflow feel like its own control plane, not a variant of the Claude bridge.

## Suggested Next Step

The next useful step is a small local service plus local web panel that can:

- read a target catalog
- open a WebSocket to one target
- initialize the App Server
- start or continue a thread
- store a local session snapshot
- render the local panel for targets, sessions, and thread state

Once that works, you can choose whether to wrap it in a CLI, a TUI, or a desktop UI.
