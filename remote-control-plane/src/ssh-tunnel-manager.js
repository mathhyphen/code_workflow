const net = require("node:net");
const { spawn } = require("node:child_process");

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function portIsReachable({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

async function waitForPort({ host, port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await portIsReachable({ host, port, timeoutMs: Math.min(1000, timeoutMs) })) {
      return;
    }
    await delay(150);
  }

  throw new Error(`SSH tunnel did not become ready on ${host}:${port} within ${timeoutMs}ms.`);
}

function reserveEphemeralPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        if (!port) {
          reject(new Error("Failed to reserve a local port for the SSH tunnel."));
          return;
        }

        resolve(port);
      });
    });
  });
}

function normalizePort(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeHost(value, fallback = "127.0.0.1") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

class SshTunnelManager {
  constructor({ logger, startupTimeoutMs = 12000, bindHost = "127.0.0.1" }) {
    this.logger = logger;
    this.startupTimeoutMs = startupTimeoutMs;
    this.bindHost = bindHost;
    this.tunnels = new Map();
  }

  listTunnels() {
    return [...this.tunnels.values()]
      .map((entry) => this.snapshot(entry))
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
  }

  snapshot(entry) {
    return {
      targetId: entry.targetId,
      status: entry.status,
      sshHost: entry.sshHost,
      sshPort: entry.sshPort,
      sshUser: entry.sshUser,
      remoteHost: entry.remoteHost,
      remotePort: entry.remotePort,
      localHost: entry.localHost,
      localPort: entry.localPort,
      destination: entry.destination,
      startedAt: entry.startedAt || null,
      pid: entry.process?.pid || null,
      lastError: entry.lastError || ""
    };
  }

  async ensureTunnel(input) {
    const targetId = String(input.targetId || "").trim();
    if (!targetId) {
      throw new Error("targetId is required for SSH tunnel management.");
    }

    const sshHost = normalizeHost(input.sshHost, "");
    if (!sshHost) {
      throw new Error(`Target ${targetId} is missing sshHost.`);
    }

    const sshPort = normalizePort(input.sshPort, 22);
    const remoteHost = normalizeHost(input.remoteHost, "127.0.0.1");
    const remotePort = normalizePort(input.remotePort, null);
    if (!remotePort) {
      throw new Error(`Target ${targetId} is missing a remote App Server port.`);
    }

    const localHost = this.bindHost;
    const localPort = normalizePort(input.localPort, await reserveEphemeralPort(localHost));
    const sshUser = String(input.sshUser || "").trim();
    const sshIdentityFile = String(input.sshIdentityFile || "").trim();
    const destination = sshUser ? `${sshUser}@${sshHost}` : sshHost;

    const existing = this.tunnels.get(targetId);
    if (existing) {
      if (
        existing.status === "ready" &&
        existing.sshHost === sshHost &&
        existing.sshPort === sshPort &&
        existing.remoteHost === remoteHost &&
        existing.remotePort === remotePort &&
        existing.localPort === localPort &&
        existing.sshUser === sshUser &&
        existing.sshIdentityFile === sshIdentityFile
      ) {
        return this.snapshot(existing);
      }

      await this.stopTunnel(targetId);
    }

    const args = [
      "-N",
      "-o",
      "BatchMode=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "LogLevel=ERROR",
      "-p",
      String(sshPort)
    ];

    if (sshIdentityFile) {
      args.push("-i", sshIdentityFile);
    }

    args.push("-L", `${localHost}:${localPort}:${remoteHost}:${remotePort}`, destination);

    const processRef = spawn("ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const entry = {
      targetId,
      sshHost,
      sshPort,
      sshUser,
      sshIdentityFile,
      remoteHost,
      remotePort,
      localHost,
      localPort,
      destination,
      status: "starting",
      startedAt: null,
      lastError: "",
      process: processRef
    };

    const readyDeferred = createDeferred();
    this.tunnels.set(targetId, entry);

    processRef.stdout.on("data", (chunk) => {
      this.logger.debug("SSH tunnel stdout.", {
        targetId,
        message: String(chunk).trim()
      });
    });

    processRef.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      entry.lastError = message;
      if (message) {
        this.logger.warn("SSH tunnel stderr.", {
          targetId,
          message
        });
      }
    });

    processRef.on("exit", (code, signal) => {
      const previousStatus = entry.status;
      entry.status = "stopped";
      if (previousStatus !== "stopped") {
        entry.lastError = entry.lastError || `ssh exited with code ${code ?? "null"} signal ${signal ?? "null"}.`;
      }
      this.tunnels.delete(targetId);
      readyDeferred.reject(new Error(entry.lastError || `SSH tunnel exited before it became ready for ${targetId}.`));
    });

    try {
      await Promise.race([
        (async () => {
          await waitForPort({
            host: localHost,
            port: localPort,
            timeoutMs: this.startupTimeoutMs
          });
          entry.status = "ready";
          entry.startedAt = new Date().toISOString();
          readyDeferred.resolve(this.snapshot(entry));
        })(),
        readyDeferred.promise
      ]);

      this.logger.info("SSH tunnel ready.", {
        targetId,
        destination,
        localPort,
        remoteHost,
        remotePort
      });

      return this.snapshot(entry);
    } catch (error) {
      await this.stopTunnel(targetId).catch(() => {});
      throw new Error(entry.lastError || error.message);
    }
  }

  async stopTunnel(targetId) {
    const entry = this.tunnels.get(targetId);
    if (!entry) {
      return {
        targetId,
        stopped: false
      };
    }

    const processRef = entry.process;
    entry.status = "stopping";
    this.tunnels.delete(targetId);

    if (!processRef.killed) {
      processRef.kill();
    }

    await delay(100);

    return {
      targetId,
      stopped: true,
      localPort: entry.localPort
    };
  }

  async close() {
    const targetIds = [...this.tunnels.keys()];
    for (const targetId of targetIds) {
      await this.stopTunnel(targetId).catch(() => {});
    }
  }
}

module.exports = {
  SshTunnelManager
};
