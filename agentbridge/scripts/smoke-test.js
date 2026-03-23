const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BridgeState } = require("../src/state.js");
const { createHttpRpcServer } = require("../src/http-rpc.js");
const { createLogger } = require("../src/logger.js");

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-${Date.now()}`,
      method,
      params
    })
  });

  return response.json();
}

async function main() {
  const tempStateFile = path.join(os.tmpdir(), `agentbridge-smoke-${Date.now()}.json`);
  const logger = createLogger("agentbridge-smoke");
  const state = new BridgeState(tempStateFile, logger);
  const server = createHttpRpcServer({
    host: "127.0.0.1",
    port: 0,
    state,
    logger
  });

  try {
    const { port } = await server.start();
    const url = `http://127.0.0.1:${port}/rpc`;

    const enqueued = await rpc(url, "enqueue_task", {
      title: "Create parser",
      description: "Build a parser and verify it with a quick test.",
      repoPath: "D:/apps/code_workflow/demo",
      acceptanceCriteria: [
        "Parser file exists",
        "Smoke test passes"
      ],
      commands: [
        "npm test"
      ]
    });

    const claimed = await rpc(url, "claim_task", {
      workerId: "smoke-worker"
    });

    const submitted = await rpc(url, "submit_result", {
      taskId: claimed.result.task.id,
      workerId: "smoke-worker",
      status: "success",
      summary: "Parser implemented and smoke test passed.",
      log: "ok"
    });

    const health = await rpc(url, "bridge_health", {});

    if (!enqueued.result.task || !claimed.result.task || !submitted.result.result) {
      throw new Error("Smoke test failed: bridge responses were incomplete.");
    }

    process.stdout.write(`${JSON.stringify({
      taskId: enqueued.result.task.id,
      resultId: submitted.result.result.id,
      queue: health.result.queue
    }, null, 2)}\n`);
  } finally {
    await server.close();
    if (fs.existsSync(tempStateFile)) {
      fs.rmSync(tempStateFile, { force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
