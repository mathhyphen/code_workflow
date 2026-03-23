const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePort(value, fallback = 22) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compactOutput(value, limit = 16000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(text.length - limit) : text;
}

class SshRemoteManager {
  constructor({ logger, timeoutMs = 120000 }) {
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.jobs = new Map();
  }

  buildRemoteScript(target, command) {
    const parts = [];
    if (target.sshShellSetup) {
      parts.push(target.sshShellSetup);
    }
    parts.push(command);
    return parts.join("; ");
  }

  buildSshArgs(target, command) {
    const remoteScript = this.buildRemoteScript(target, command);
    const destination = target.sshUser
      ? `${target.sshUser}@${target.sshHost}`
      : target.sshHost;

    const args = [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-p",
      String(normalizePort(target.sshPort, 22))
    ];

    if (target.sshIdentityFile) {
      args.push("-i", target.sshIdentityFile);
    }

    return {
      args: [...args, destination, "bash", "-s"],
      script: `set -e\n${remoteScript}\n`
    };
  }

  buildCopyArgs(target, localPath, remotePath) {
    const destination = target.sshUser
      ? `${target.sshUser}@${target.sshHost}:${remotePath}`
      : `${target.sshHost}:${remotePath}`;

    const args = [
      "-q",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-P",
      String(normalizePort(target.sshPort, 22))
    ];

    if (target.sshIdentityFile) {
      args.push("-i", target.sshIdentityFile);
    }

    return [...args, localPath, destination];
  }

  async exec(target, command, options = {}) {
    if (!target.sshEnabled) {
      throw new Error(`Target ${target.id} does not have SSH enabled.`);
    }
    if (!target.sshHost) {
      throw new Error(`Target ${target.id} is missing sshHost.`);
    }

    const sshCommand = this.buildSshArgs(target, command);
    const timeoutMs = options.timeoutMs || this.timeoutMs;

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", sshCommand.args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      const timer = setTimeout(() => {
        stderr = compactOutput(`${stderr}\nTimed out after ${timeoutMs}ms.`);
        child.kill();
        finish(reject, new Error(stderr.trim()));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout = compactOutput(`${stdout}${String(chunk)}`);
      });
      child.stderr.on("data", (chunk) => {
        stderr = compactOutput(`${stderr}${String(chunk)}`);
      });

      child.on("error", (error) => {
        finish(reject, error);
      });

      child.stdin.end(sshCommand.script);

      child.on("exit", (code, signal) => {
        const result = {
          code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        };

        if (code === 0) {
          finish(resolve, result);
          return;
        }

        const message = result.stderr || result.stdout || `ssh command failed with code ${code ?? "null"} signal ${signal ?? "null"}`;
        finish(reject, new Error(message));
      });
    });
  }

  async uploadFile(target, localPath, remotePath, options = {}) {
    if (!target.sshEnabled) {
      throw new Error(`Target ${target.id} does not have SSH enabled.`);
    }
    if (!target.sshHost) {
      throw new Error(`Target ${target.id} is missing sshHost.`);
    }

    const args = this.buildCopyArgs(target, localPath, remotePath);
    const timeoutMs = options.timeoutMs || this.timeoutMs;

    return new Promise((resolve, reject) => {
      const child = spawn("scp", args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      const timer = setTimeout(() => {
        stderr = compactOutput(`${stderr}\nTimed out after ${timeoutMs}ms.`);
        child.kill();
        finish(reject, new Error(stderr.trim()));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout = compactOutput(`${stdout}${String(chunk)}`);
      });
      child.stderr.on("data", (chunk) => {
        stderr = compactOutput(`${stderr}${String(chunk)}`);
      });
      child.on("error", (error) => {
        finish(reject, error);
      });
      child.on("exit", (code, signal) => {
        const result = {
          code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        };

        if (code === 0) {
          finish(resolve, result);
          return;
        }

        const message = result.stderr || result.stdout || `scp failed with code ${code ?? "null"} signal ${signal ?? "null"}`;
        finish(reject, new Error(message));
      });
    });
  }

  startJob(target, command) {
    if (!target.sshEnabled) {
      throw new Error(`Target ${target.id} does not have SSH enabled.`);
    }
    if (!target.sshHost) {
      throw new Error(`Target ${target.id} is missing sshHost.`);
    }

    const jobId = crypto.randomUUID();
    const sshCommand = this.buildSshArgs(target, command);
    const child = spawn("ssh", sshCommand.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const job = {
      id: jobId,
      targetId: target.id,
      status: "running",
      stdout: "",
      stderr: "",
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
      signal: null,
      pid: child.pid || null,
      process: child
    };

    child.stdout.on("data", (chunk) => {
      job.stdout = compactOutput(`${job.stdout}${String(chunk)}`);
    });

    child.stderr.on("data", (chunk) => {
      job.stderr = compactOutput(`${job.stderr}${String(chunk)}`);
    });

    child.on("error", (error) => {
      job.status = "failed";
      job.stderr = compactOutput(`${job.stderr}\n${error.message}`.trim());
      job.completedAt = new Date().toISOString();
    });

    child.on("exit", (code, signal) => {
      job.exitCode = code;
      job.signal = signal;
      job.completedAt = new Date().toISOString();
      job.status = code === 0 ? "completed" : "failed";
    });

    child.stdin.end(sshCommand.script);

    this.jobs.set(jobId, job);
    return this.readJob(jobId);
  }

  readJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Remote auth job not found: ${jobId}`);
    }

    return {
      id: job.id,
      targetId: job.targetId,
      status: job.status,
      stdout: job.stdout,
      stderr: job.stderr,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      exitCode: job.exitCode,
      signal: job.signal,
      pid: job.pid
    };
  }

  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Remote auth job not found: ${jobId}`);
    }

    if (job.status === "running" && job.process && !job.process.killed) {
      job.process.kill();
      await delay(100);
    }

    job.status = "cancelled";
    job.completedAt = job.completedAt || new Date().toISOString();

    return this.readJob(jobId);
  }
}

module.exports = {
  SshRemoteManager
};
