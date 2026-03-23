const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { startControlPlane } = require("../src/index.js");

function randomPort(base) {
  return base + Math.floor(Math.random() * 1000);
}

async function rpc(url, method, params = {}) {
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

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC failed: ${method}`);
  }

  return payload.result;
}

async function waitForRpc(url, method, params, retries = 20) {
  let lastError = null;

  for (let index = 0; index < retries; index += 1) {
    try {
      return await rpc(url, method, params);
    } catch (error) {
      lastError = error;
      await delay(1000);
    }
  }

  throw lastError || new Error(`Unable to call ${method}`);
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const workspaceRoot = path.resolve(projectRoot, "..");
  const controlPort = randomPort(8876);
  const appServerPort = randomPort(4599);
  const codexScript = "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\codex.ps1";
  const stateFile = path.resolve(projectRoot, "data", "smoke-state.json");

  const appServerChild = spawn(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      codexScript,
      "app-server",
      "--listen",
      `ws://127.0.0.1:${appServerPort}`
    ],
    {
      cwd: workspaceRoot,
      stdio: "ignore"
    }
  );

  let controlPlane = null;

  try {
    controlPlane = await startControlPlane({
      host: "127.0.0.1",
      port: controlPort,
      stateFile,
      requestTimeoutMs: 60000,
      turnTimeoutMs: 180000
    });

    const controlUrl = `http://127.0.0.1:${controlPort}/rpc`;
    await waitForRpc(controlUrl, "control_health", {});
    const panelResponse = await fetch(`http://127.0.0.1:${controlPort}/`);
    const panelHtml = await panelResponse.text();
    if (!panelHtml.includes("Codex Remote Control Plane")) {
      throw new Error("Local web panel did not render expected HTML.");
    }

    await rpc(controlUrl, "target_upsert", {
      id: "local-smoke",
      label: "Local smoke App Server",
      url: `ws://127.0.0.1:${appServerPort}`,
      defaultCwd: workspaceRoot,
      defaultModel: "gpt-5.4-mini",
      defaultApprovalPolicy: "never",
      defaultSandbox: "workspace-write"
    });

    const probe = await waitForRpc(controlUrl, "target_probe", {
      targetId: "local-smoke"
    });

    if (!probe.initialize?.platformOs) {
      throw new Error("Probe did not return initialize metadata.");
    }

    const threadResult = await rpc(controlUrl, "thread_start", {
      targetId: "local-smoke",
      prompt: "Reply with exactly the word PING.",
      waitForCompletion: true
    });

    const finalMessage = threadResult.assistantMessages?.[threadResult.assistantMessages.length - 1] || "";
    if (finalMessage.trim() !== "PING") {
      throw new Error(`Unexpected final assistant message: ${finalMessage}`);
    }

    process.stdout.write("Smoke test passed.\n");
  } finally {
    if (controlPlane) {
      await controlPlane.close().catch(() => {});
    }

    appServerChild.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
