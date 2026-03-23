const path = require("node:path");
const { spawn } = require("node:child_process");
const { readConfig } = require("../src/config.js");
const { BridgeClient } = require("../src/bridge-client.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridge(config, timeoutMs = 15000) {
  const startedAt = Date.now();
  const healthUrl = `http://${config.host}:${config.port}/health`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return await response.json();
      }
    } catch {
    }

    await sleep(500);
  }

  throw new Error(`Bridge did not become healthy within ${timeoutMs}ms`);
}

async function ensureStackRunning(options = {}) {
  const { ensureWorker = true } = options;
  const config = readConfig();
  const daemonEntry = path.resolve(config.projectRoot, "src/index.js");
  let daemonStarted = false;

  try {
    await waitForBridge(config, 1000);
  } catch {
    const child = spawn(process.execPath, [daemonEntry], {
      cwd: config.projectRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.unref();
    daemonStarted = true;
    await waitForBridge(config, 15000);
  }

  const client = new BridgeClient(config.bridgeUrl);
  let workerStarted = false;

  if (ensureWorker) {
    const status = await client.call("worker_status", {});
    if (!status.worker || !status.worker.running) {
      await client.call("worker_start", {});
      workerStarted = true;
    }
  }

  return {
    client,
    config,
    daemonStarted,
    workerStarted
  };
}

module.exports = {
  ensureStackRunning
};
