const { AppServerClient } = require("./app-server-client.js");

function compactObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      output[key] = value;
    }
  }
  return output;
}

function itemText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (item.type === "agentMessage") {
    return item.text || "";
  }

  if (item.type === "userMessage" && Array.isArray(item.content)) {
    return item.content
      .map((entry) => entry?.text || "")
      .join("")
      .trim();
  }

  return "";
}

function extractTurnSummary(thread, turnId = null) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const turn = turnId
    ? turns.find((item) => item.id === turnId) || turns[turns.length - 1] || null
    : turns[turns.length - 1] || null;

  if (!turn) {
    return {
      turn: null,
      assistantMessages: []
    };
  }

  const assistantMessages = (turn.items || [])
    .filter((item) => item.type === "agentMessage")
    .map((item) => itemText(item))
    .filter(Boolean);

  return {
    turn,
    assistantMessages
  };
}

class ControlPlaneService {
  constructor({ state, logger, config, tunnelManager, sshRemoteManager }) {
    this.state = state;
    this.logger = logger;
    this.config = config;
    this.tunnelManager = tunnelManager;
    this.sshRemoteManager = sshRemoteManager;
  }

  buildTunnelSnapshot(target) {
    if (!target.sshEnabled) {
      return {
        targetId: target.id,
        enabled: false,
        status: "direct",
        connected: true,
        localUrl: target.url,
        localPort: null,
        remoteUrl: target.url
      };
    }

    const liveTunnel = this.tunnelManager
      ? this.tunnelManager.listTunnels().find((item) => item.targetId === target.id) || null
      : null;

    if (!liveTunnel) {
      return {
        targetId: target.id,
        enabled: true,
        connected: false,
        status: "disconnected",
        sshHost: target.sshHost,
        sshPort: target.sshPort || "22",
        sshUser: target.sshUser || "",
        localPort: target.sshLocalPort || null,
        localUrl: target.sshLocalPort ? `ws://127.0.0.1:${target.sshLocalPort}` : null,
        remoteUrl: target.url,
        lastError: ""
      };
    }

    return {
      ...liveTunnel,
      enabled: true,
      connected: liveTunnel.status === "ready",
      localUrl: `ws://127.0.0.1:${liveTunnel.localPort}`,
      remoteUrl: target.url
    };
  }

  decorateTarget(target) {
    return {
      ...target,
      tunnel: this.buildTunnelSnapshot(target)
    };
  }

  health() {
    return {
      status: "ok",
      host: this.config.host,
      port: this.config.port,
      stateFile: this.state.filePath,
      targets: this.state.listTargets().length,
      authProfiles: this.state.listAuthProfiles().length,
      sessions: this.state.listSessions({ limit: 1000 }).length,
      tunnels: this.tunnelManager ? this.tunnelManager.listTunnels().length : 0
    };
  }

  listTargets() {
    return {
      targets: this.state.listTargets().map((target) => this.decorateTarget(target))
    };
  }

  listAuthProfiles() {
    return {
      profiles: this.state.listAuthProfiles()
    };
  }

  importLocalAuthProfile(params = {}) {
    return {
      profile: this.state.importLocalCodexAuthProfile(params)
    };
  }

  upsertAuthProfile(params) {
    return {
      profile: this.state.upsertAuthProfile(params)
    };
  }

  removeAuthProfile(params) {
    return this.state.removeAuthProfile(params.profileId);
  }

  upsertTarget(params) {
    const target = this.state.upsertTarget(params);
    return {
      target: this.decorateTarget(target)
    };
  }

  async removeTarget(params) {
    if (this.tunnelManager) {
      await this.tunnelManager.stopTunnel(params.targetId).catch(() => {});
    }
    return this.state.removeTarget(params.targetId);
  }

  listSessions(params = {}) {
    return {
      sessions: this.state.listSessions({
        targetId: params.targetId || null,
        limit: Number.isFinite(Number(params.limit)) ? Number(params.limit) : 50
      })
    };
  }

  listTunnels() {
    const targets = this.state.listTargets();
    return {
      tunnels: targets.map((target) => this.buildTunnelSnapshot(target))
    };
  }

  resolveTarget(targetId) {
    if (!targetId) {
      throw new Error("targetId is required.");
    }

    return this.state.getTarget(targetId);
  }

  async prepareConnection(target) {
    if (!target.sshEnabled) {
      return {
        target: this.decorateTarget(target),
        clientUrl: target.url,
        tunnel: null
      };
    }

    if (!this.tunnelManager) {
      throw new Error("SSH tunnel manager is not available.");
    }

    let parsed;
    try {
      parsed = new URL(target.url);
    } catch (error) {
      throw new Error(`Target ${target.id} has an invalid URL: ${error.message}`);
    }

    if (parsed.protocol !== "ws:") {
      throw new Error(`SSH-assisted targets must use a ws:// URL. Received ${target.url}`);
    }

    const remotePort = Number.parseInt(parsed.port || "", 10);
    if (!Number.isFinite(remotePort) || remotePort <= 0) {
      throw new Error(`Target ${target.id} must include an explicit App Server port in its URL.`);
    }

    const tunnel = await this.tunnelManager.ensureTunnel({
      targetId: target.id,
      sshHost: target.sshHost,
      sshPort: target.sshPort,
      sshUser: target.sshUser,
      sshLocalPort: target.sshLocalPort,
      sshIdentityFile: target.sshIdentityFile,
      remoteHost: parsed.hostname,
      remotePort
    });

    const clientUrl = new URL(target.url);
    clientUrl.hostname = tunnel.localHost;
    clientUrl.port = String(tunnel.localPort);

    return {
      target,
      clientUrl: clientUrl.toString(),
      tunnel
    };
  }

  async connectTarget(params) {
    const target = this.resolveTarget(params.targetId);
    const connection = await this.prepareConnection(target);

    return {
      target: this.decorateTarget(target),
      connection: {
        clientUrl: connection.clientUrl,
        tunnel: connection.tunnel
      }
    };
  }

  async disconnectTarget(params) {
    const target = this.resolveTarget(params.targetId);
    if (!target.sshEnabled) {
      return {
        target: this.decorateTarget(target),
        disconnected: false,
        reason: "Target does not use an SSH tunnel."
      };
    }

    if (!this.tunnelManager) {
      throw new Error("SSH tunnel manager is not available.");
    }

    const disconnected = await this.tunnelManager.stopTunnel(target.id);
    return {
      target: this.decorateTarget(target),
      ...disconnected
    };
  }

  codexCommand(target) {
    return target.sshCodexCommand || "codex";
  }

  resolveTargets(targetIds = []) {
    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      throw new Error("targetIds is required.");
    }

    return targetIds.map((targetId) => {
      const target = this.resolveTarget(targetId);
      if (!target.sshEnabled) {
        throw new Error(`Target ${target.id} is not SSH-enabled.`);
      }
      return target;
    });
  }

  async remoteAuthStatus(params) {
    const target = this.resolveTarget(params.targetId);
    if (!this.sshRemoteManager) {
      throw new Error("SSH remote manager is not available.");
    }

    const result = await this.sshRemoteManager.exec(
      target,
      `${this.codexCommand(target)} login status`,
      { timeoutMs: params.timeoutMs || 30000 }
    );

    return {
      target: this.decorateTarget(target),
      status: result.stdout || result.stderr || "No output."
    };
  }

  async remoteAuthLogout(params) {
    const target = this.resolveTarget(params.targetId);
    if (!this.sshRemoteManager) {
      throw new Error("SSH remote manager is not available.");
    }

    const result = await this.sshRemoteManager.exec(
      target,
      `${this.codexCommand(target)} logout`,
      { timeoutMs: params.timeoutMs || 30000 }
    );

    return {
      target: this.decorateTarget(target),
      output: result.stdout || result.stderr || "Logged out."
    };
  }

  async applyAuthProfile(params) {
    if (!this.sshRemoteManager) {
      throw new Error("SSH remote manager is not available.");
    }

    const profile = this.state.getAuthProfile(params.profileId, { includeSecret: true });
    const targets = this.resolveTargets(params.targetIds);
    const results = [];

    for (const target of targets) {
      try {
        if (profile.authType === "api_key") {
          const encodedKey = Buffer.from(profile.apiKey, "utf8").toString("base64");
          const logout = await this.sshRemoteManager.exec(
            target,
            `${this.codexCommand(target)} logout >/dev/null 2>&1 || true`,
            { timeoutMs: params.timeoutMs || 30000 }
          );

          const login = await this.sshRemoteManager.exec(
            target,
            `printf '%s' '${encodedKey}' | base64 -d | ${this.codexCommand(target)} login --with-api-key`,
            { timeoutMs: params.timeoutMs || 60000 }
          );

          const status = await this.sshRemoteManager.exec(
            target,
            `${this.codexCommand(target)} login status`,
            { timeoutMs: params.timeoutMs || 30000 }
          );

          results.push({
            targetId: target.id,
            targetLabel: target.label,
            ok: true,
            authType: profile.authType,
            logoutOutput: logout.stdout || logout.stderr || "",
            loginOutput: login.stdout || login.stderr || "",
            status: status.stdout || status.stderr || ""
          });
          continue;
        }

        if (profile.authType === "chatgpt_session") {
          await this.sshRemoteManager.exec(
            target,
            "mkdir -p ~/.codex && rm -f ~/.codex/auth.json ~/.codex/cap_sid",
            { timeoutMs: params.timeoutMs || 30000 }
          );

          await this.sshRemoteManager.uploadFile(
            target,
            profile.authJsonPath,
            "~/.codex/auth.json",
            { timeoutMs: params.timeoutMs || 30000 }
          );

          if (profile.capSidPath) {
            await this.sshRemoteManager.uploadFile(
              target,
              profile.capSidPath,
              "~/.codex/cap_sid",
              { timeoutMs: params.timeoutMs || 30000 }
            );
          }

          const status = await this.sshRemoteManager.exec(
            target,
            `${this.codexCommand(target)} login status`,
            { timeoutMs: params.timeoutMs || 30000 }
          );

          results.push({
            targetId: target.id,
            targetLabel: target.label,
            ok: true,
            authType: profile.authType,
            loginOutput: "Copied local Codex auth bundle to remote ~/.codex.",
            status: status.stdout || status.stderr || ""
          });
          continue;
        }

        throw new Error(`Unsupported auth profile type: ${profile.authType}`);
      } catch (error) {
        results.push({
          targetId: target.id,
          targetLabel: target.label,
          ok: false,
          error: error.message
        });
      }
    }

    return {
      profile: this.state.getAuthProfile(params.profileId),
      results
    };
  }

  startRemoteDeviceAuth(params) {
    const target = this.resolveTarget(params.targetId);
    if (!this.sshRemoteManager) {
      throw new Error("SSH remote manager is not available.");
    }

    const job = this.sshRemoteManager.startJob(
      target,
      `${this.codexCommand(target)} login --device-auth`
    );

    return {
      target: this.decorateTarget(target),
      job
    };
  }

  readRemoteAuthJob(params) {
    if (!this.sshRemoteManager) {
      throw new Error("SSH remote manager is not available.");
    }

    return {
      job: this.sshRemoteManager.readJob(params.jobId)
    };
  }

  async cancelRemoteAuthJob(params) {
    if (!this.sshRemoteManager) {
      throw new Error("SSH remote manager is not available.");
    }

    return {
      job: await this.sshRemoteManager.cancelJob(params.jobId)
    };
  }

  async withClient(target, fn) {
    const connection = await this.prepareConnection(target);
    const client = new AppServerClient({
      url: connection.clientUrl,
      logger: this.logger,
      clientInfo: this.config.clientInfo,
      connectTimeoutMs: this.config.connectTimeoutMs,
      requestTimeoutMs: this.config.requestTimeoutMs
    });

    try {
      await client.connect();
      const initialize = await client.request("initialize", {
        clientInfo: this.config.clientInfo,
        capabilities: {
          experimentalApi: true
        }
      });

      return await fn(client, initialize, connection);
    } finally {
      await client.close().catch(() => {});
    }
  }

  async probeTarget(params) {
    const target = this.resolveTarget(params.targetId);
    return this.withClient(target, async (_client, initialize, connection) => ({
      target: this.decorateTarget(target),
      initialize,
      connection: {
        clientUrl: connection.clientUrl,
        tunnel: connection.tunnel
      }
    }));
  }

  async startThread(params) {
    const target = this.resolveTarget(params.targetId);

    return this.withClient(target, async (client, initialize, connection) => {
      const threadResponse = await client.request("thread/start", compactObject({
        cwd: params.cwd || target.defaultCwd,
        model: params.model || target.defaultModel || this.config.defaultModel,
        approvalPolicy: params.approvalPolicy || target.defaultApprovalPolicy || "never",
        sandbox: params.sandbox || target.defaultSandbox || "workspace-write",
        personality: params.personality,
        serviceName: params.serviceName,
        developerInstructions: params.developerInstructions,
        baseInstructions: params.baseInstructions
      }));

      const thread = threadResponse.thread;
      let turn = null;
      let threadSnapshot = thread;
      let assistantMessages = [];

      if (params.prompt) {
        const turnResponse = await client.request("turn/start", compactObject({
          threadId: thread.id,
          cwd: params.cwd || target.defaultCwd,
          model: params.model || target.defaultModel || this.config.defaultModel,
          approvalPolicy: params.approvalPolicy || target.defaultApprovalPolicy || "never",
          input: [
            {
              type: "text",
              text: String(params.prompt)
            }
          ],
          effort: params.effort,
          summary: params.summary
        }));

        turn = turnResponse.turn;

        if (params.waitForCompletion !== false) {
          turn = await client.waitForTurnCompletion({
            threadId: thread.id,
            turnId: turn.id,
            timeoutMs: params.turnTimeoutMs || this.config.turnTimeoutMs
          });
          const readResponse = await client.request("thread/read", {
            threadId: thread.id,
            includeTurns: true
          });
          threadSnapshot = readResponse.thread;
          const turnSummary = extractTurnSummary(threadSnapshot, turn.id);
          assistantMessages = turnSummary.assistantMessages;
          turn = turnSummary.turn || turn;
        }
      }

      this.state.upsertSession({
        targetId: target.id,
        targetLabel: target.label,
        threadId: thread.id,
        preview: threadSnapshot.preview || params.prompt || "",
        cwd: threadSnapshot.cwd || params.cwd || target.defaultCwd,
        model: params.model || target.defaultModel || this.config.defaultModel,
        status: threadSnapshot.status?.type || "idle",
        lastTurnId: turn?.id || null,
        lastTurnStatus: turn?.status || null,
        lastAssistantMessage: assistantMessages[assistantMessages.length - 1] || ""
      });

      return {
        target: this.decorateTarget(target),
        initialize,
        connection: {
          clientUrl: connection.clientUrl,
          tunnel: connection.tunnel
        },
        thread: threadSnapshot,
        turn,
        assistantMessages
      };
    });
  }

  async startTurn(params) {
    const target = this.resolveTarget(params.targetId);
    if (!params.threadId) {
      throw new Error("threadId is required.");
    }
    if (!params.prompt) {
      throw new Error("prompt is required.");
    }

    return this.withClient(target, async (client, initialize, connection) => {
      const turnResponse = await client.request("turn/start", compactObject({
        threadId: params.threadId,
        cwd: params.cwd || target.defaultCwd,
        model: params.model || target.defaultModel || this.config.defaultModel,
        approvalPolicy: params.approvalPolicy || target.defaultApprovalPolicy || "never",
        input: [
          {
            type: "text",
            text: String(params.prompt)
          }
        ],
        effort: params.effort,
        summary: params.summary
      }));

      let turn = turnResponse.turn;
      let threadSnapshot = null;
      let assistantMessages = [];

      if (params.waitForCompletion !== false) {
        turn = await client.waitForTurnCompletion({
          threadId: params.threadId,
          turnId: turn.id,
          timeoutMs: params.turnTimeoutMs || this.config.turnTimeoutMs
        });

        const readResponse = await client.request("thread/read", {
          threadId: params.threadId,
          includeTurns: true
        });
        threadSnapshot = readResponse.thread;
        const turnSummary = extractTurnSummary(threadSnapshot, turn.id);
        assistantMessages = turnSummary.assistantMessages;
        turn = turnSummary.turn || turn;
      }

      this.state.upsertSession({
        targetId: target.id,
        targetLabel: target.label,
        threadId: params.threadId,
        preview: threadSnapshot?.preview || params.prompt,
        cwd: threadSnapshot?.cwd || params.cwd || target.defaultCwd,
        model: params.model || target.defaultModel || this.config.defaultModel,
        status: threadSnapshot?.status?.type || "idle",
        lastTurnId: turn?.id || null,
        lastTurnStatus: turn?.status || null,
        lastAssistantMessage: assistantMessages[assistantMessages.length - 1] || ""
      });

      return {
        target: this.decorateTarget(target),
        initialize,
        connection: {
          clientUrl: connection.clientUrl,
          tunnel: connection.tunnel
        },
        thread: threadSnapshot,
        turn,
        assistantMessages
      };
    });
  }

  async readThread(params) {
    const target = this.resolveTarget(params.targetId);
    if (!params.threadId) {
      throw new Error("threadId is required.");
    }

    return this.withClient(target, async (client, initialize, connection) => {
      const response = await client.request("thread/read", {
        threadId: params.threadId,
        includeTurns: params.includeTurns !== false
      });
      const turnSummary = extractTurnSummary(response.thread);

      this.state.upsertSession({
        targetId: target.id,
        targetLabel: target.label,
        threadId: params.threadId,
        preview: response.thread.preview || "",
        cwd: response.thread.cwd,
        model: target.defaultModel || this.config.defaultModel,
        status: response.thread.status?.type || "idle",
        lastTurnId: turnSummary.turn?.id || null,
        lastTurnStatus: turnSummary.turn?.status || null,
        lastAssistantMessage: turnSummary.assistantMessages[turnSummary.assistantMessages.length - 1] || ""
      });

      return {
        target: this.decorateTarget(target),
        initialize,
        connection: {
          clientUrl: connection.clientUrl,
          tunnel: connection.tunnel
        },
        thread: response.thread,
        assistantMessages: turnSummary.assistantMessages
      };
    });
  }

  async listThreads(params) {
    const target = this.resolveTarget(params.targetId);

    return this.withClient(target, async (client, initialize, connection) => {
      const response = await client.request("thread/list", compactObject({
        limit: params.limit,
        cursor: params.cursor,
        includeArchived: params.includeArchived
      }));

      return {
        target: this.decorateTarget(target),
        initialize,
        connection: {
          clientUrl: connection.clientUrl,
          tunnel: connection.tunnel
        },
        threads: response.data || response.threads || response.items || [],
        ...response
      };
    });
  }
}

module.exports = {
  ControlPlaneService
};
