#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");

const scriptMap = {
  start: path.resolve(__dirname, "index.js"),
  mcp: path.resolve(__dirname, "mcp-stdio.js"),
  stack: path.resolve(__dirname, "..", "scripts", "start-stack.js"),
  delegate: path.resolve(__dirname, "..", "scripts", "delegate-task.js"),
  "init-loop": path.resolve(__dirname, "..", "scripts", "init-project-loop.js"),
  rpc: path.resolve(__dirname, "..", "scripts", "rpc-call.js"),
  smoke: path.resolve(__dirname, "..", "scripts", "smoke-test.js")
};

function printHelp() {
  process.stdout.write(
    [
      "code-workflow",
      "",
      "Usage:",
      "  code-workflow <command> [args...]",
      "",
      "Commands:",
      "  start                  Start the AgentBridge daemon",
      "  stack                  Ensure the daemon and Claude worker are running",
      "  delegate <task>        Enqueue a task from JSON or @file.json",
      "  init-loop <repo>       Initialize the research loop files in a repo",
      "  rpc <method> [params]  Call the JSON-RPC API directly",
      "  mcp                    Start the MCP stdio adapter",
      "  smoke                  Run the local smoke test",
      "",
      "Examples:",
      "  code-workflow stack",
      "  code-workflow init-loop D:\\apps\\my_project",
      "  code-workflow delegate @task.json",
      "  code-workflow rpc worker_status",
      ""
    ].join("\n")
  );
}

function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  const scriptPath = scriptMap[command];

  if (!scriptPath) {
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    process.exit(1);
  }

  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    windowsHide: true
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

main();
