const path = require("node:path");

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readConfig(overrides = {}) {
  const projectRoot = path.resolve(__dirname, "..");
  const host = overrides.host || process.env.CODEX_CONTROL_HOST || "127.0.0.1";
  const port = overrides.port || asPositiveInteger(process.env.CODEX_CONTROL_PORT, 8876);
  const stateFile = path.resolve(
    projectRoot,
    overrides.stateFile || process.env.CODEX_CONTROL_STATE_FILE || "./data/control-plane-state.json"
  );

  return {
    projectRoot,
    host,
    port,
    stateFile,
    controlUrl: overrides.controlUrl || process.env.CODEX_CONTROL_URL || `http://${host}:${port}/rpc`,
    requestTimeoutMs: overrides.requestTimeoutMs || asPositiveInteger(process.env.CODEX_CONTROL_REQUEST_TIMEOUT_MS, 60000),
    connectTimeoutMs: overrides.connectTimeoutMs || asPositiveInteger(process.env.CODEX_CONTROL_CONNECT_TIMEOUT_MS, 10000),
    tunnelStartupTimeoutMs: overrides.tunnelStartupTimeoutMs || asPositiveInteger(process.env.CODEX_CONTROL_TUNNEL_STARTUP_TIMEOUT_MS, 12000),
    turnTimeoutMs: overrides.turnTimeoutMs || asPositiveInteger(process.env.CODEX_CONTROL_TURN_TIMEOUT_MS, 180000),
    defaultModel: overrides.defaultModel || process.env.CODEX_CONTROL_DEFAULT_MODEL || "gpt-5.4",
    clientInfo: {
      name: overrides.clientName || "codex-remote-control-plane",
      version: overrides.clientVersion || "0.1.0"
    }
  };
}

module.exports = {
  readConfig
};
