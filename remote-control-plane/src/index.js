const { readConfig } = require("./config.js");
const { createLogger } = require("./logger.js");
const { ControlPlaneState } = require("./state.js");
const { ControlPlaneService } = require("./control-plane.js");
const { createHttpRpcServer } = require("./http-rpc.js");
const { SshTunnelManager } = require("./ssh-tunnel-manager.js");
const { SshRemoteManager } = require("./ssh-remote.js");

async function startControlPlane(overrides = {}) {
  const config = readConfig(overrides);
  const logger = createLogger("remote-control-plane");
  const state = new ControlPlaneState(config.stateFile, logger);
  const tunnelManager = new SshTunnelManager({
    logger,
    startupTimeoutMs: config.tunnelStartupTimeoutMs
  });
  const sshRemoteManager = new SshRemoteManager({
    logger
  });
  const service = new ControlPlaneService({
    state,
    logger,
    config,
    tunnelManager,
    sshRemoteManager
  });
  const rpcServer = createHttpRpcServer({
    host: config.host,
    port: config.port,
    logger,
    service,
    staticDir: overrides.staticDir || require("node:path").resolve(__dirname, "..", "public")
  });

  await rpcServer.start();

  return {
    config,
    state,
    service,
    tunnelManager,
    sshRemoteManager,
    rpcServer,
    async close() {
      await tunnelManager.close().catch(() => {});
      await rpcServer.close();
    }
  };
}

if (require.main === module) {
  startControlPlane().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  startControlPlane
};
