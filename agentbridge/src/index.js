const { BridgeState } = require("./state.js");
const { createHttpRpcServer } = require("./http-rpc.js");
const { createLogger } = require("./logger.js");
const { readConfig } = require("./config.js");
const { ClaudeWorkerManager } = require("./claude-worker.js");

async function startDaemon() {
  const logger = createLogger("agentbridge");
  const config = readConfig();
  const state = new BridgeState(config.stateFile, logger);
  const workerManager = new ClaudeWorkerManager({
    state,
    logger: createLogger("claude-worker"),
    config
  });
  const rpcServer = createHttpRpcServer({
    host: config.host,
    port: config.port,
    state,
    logger,
    workerManager,
    config
  });

  await rpcServer.start();

  if (config.worker.autoStart) {
    await workerManager.start();
  }

  const shutdown = async (signal) => {
    logger.info("Shutting down AgentBridge daemon.", { signal });
    await Promise.allSettled([
      workerManager.close(),
      rpcServer.close()
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

if (require.main === module) {
  startDaemon().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  startDaemon
};
