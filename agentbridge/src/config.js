const path = require("node:path");

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function readConfig() {
  const projectRoot = path.resolve(__dirname, "..");
  const host = process.env.AGENTBRIDGE_HOST || "127.0.0.1";
  const port = asPositiveInteger(process.env.AGENTBRIDGE_PORT, 8765);
  const stateFile = path.resolve(
    projectRoot,
    process.env.AGENTBRIDGE_STATE_FILE || "./data/bridge-state.json"
  );

  return {
    projectRoot,
    host,
    port,
    bridgeUrl: process.env.AGENTBRIDGE_URL || `http://${host}:${port}/rpc`,
    defaultWaitSeconds: asPositiveInteger(process.env.AGENTBRIDGE_DEFAULT_WAIT_SECONDS, 30),
    stateFile,
    worker: {
      autoStart: asBoolean(process.env.AGENTBRIDGE_AUTO_START_CLAUDE, false),
      idlePollSeconds: asPositiveInteger(process.env.AGENTBRIDGE_WORKER_IDLE_SECONDS, 10),
      timeoutSeconds: asPositiveInteger(process.env.AGENTBRIDGE_CLAUDE_TIMEOUT_SECONDS, 1800),
      workerId: process.env.AGENTBRIDGE_WORKER_ID || "claude-auto-worker",
      claudeBin: process.env.CLAUDE_BIN || "claude",
      model: process.env.AGENTBRIDGE_CLAUDE_MODEL || "",
      permissionMode: process.env.AGENTBRIDGE_CLAUDE_PERMISSION_MODE || "bypassPermissions",
      extraArgs: parseJsonArray(process.env.AGENTBRIDGE_CLAUDE_EXTRA_ARGS)
    }
  };
}

module.exports = {
  readConfig
};
