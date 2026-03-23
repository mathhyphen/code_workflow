const state = {
  targets: [],
  sessions: [],
  authProfiles: [],
  tunnelsByTargetId: {},
  selectedTargetId: "",
  selectedThreadId: "",
  selectedAuthProfileId: "",
  batchTargetIds: [],
  activeThread: null,
  authJobId: "",
  authPollTimer: null,
  threadPollTimer: null,
  toastTimer: null
};

const elements = {
  metricStatus: document.querySelector("#metric-status"),
  metricEndpoint: document.querySelector("#metric-endpoint"),
  metricTargets: document.querySelector("#metric-targets"),
  metricSessions: document.querySelector("#metric-sessions"),
  metricTunnels: document.querySelector("#metric-tunnels"),
  statusPill: document.querySelector("#status-pill"),
  panelMessage: document.querySelector("#panel-message"),
  targetList: document.querySelector("#target-list"),
  sessionList: document.querySelector("#session-list"),
  remoteThreadList: document.querySelector("#remote-thread-list"),
  assistantOutput: document.querySelector("#assistant-output"),
  threadTurns: document.querySelector("#thread-turns"),
  detailMeta: document.querySelector("#detail-meta"),
  detailTitle: document.querySelector("#detail-title"),
  detailBreadcrumb: document.querySelector("#detail-breadcrumb"),
  threadStatusBanner: document.querySelector("#thread-status-banner"),
  composeTarget: document.querySelector("#compose-target"),
  composeThreadId: document.querySelector("#compose-thread-id"),
  composeCwd: document.querySelector("#compose-cwd"),
  composeModel: document.querySelector("#compose-model"),
  composeApproval: document.querySelector("#compose-approval"),
  composeSandbox: document.querySelector("#compose-sandbox"),
  composePrompt: document.querySelector("#compose-prompt"),
  targetForm: document.querySelector("#target-form"),
  targetHiddenId: document.querySelector("#target-id"),
  targetLabel: document.querySelector("#target-label"),
  targetIdInput: document.querySelector("#target-id-input"),
  targetUrl: document.querySelector("#target-url"),
  targetCwd: document.querySelector("#target-cwd"),
  targetModel: document.querySelector("#target-model"),
  targetApproval: document.querySelector("#target-approval"),
  targetSandbox: document.querySelector("#target-sandbox"),
  targetNotes: document.querySelector("#target-notes"),
  targetSshEnabled: document.querySelector("#target-ssh-enabled"),
  targetSshHost: document.querySelector("#target-ssh-host"),
  targetSshUser: document.querySelector("#target-ssh-user"),
  targetSshPort: document.querySelector("#target-ssh-port"),
  targetSshLocalPort: document.querySelector("#target-ssh-local-port"),
  targetSshIdentityFile: document.querySelector("#target-ssh-identity-file"),
  targetSshShellSetup: document.querySelector("#target-ssh-shell-setup"),
  targetSshCodexCommand: document.querySelector("#target-ssh-codex-command"),
  sshFields: document.querySelector("#ssh-fields"),
  authTargetLabel: document.querySelector("#auth-target-label"),
  authOutput: document.querySelector("#auth-output"),
  authStatus: document.querySelector("#auth-status"),
  authLogout: document.querySelector("#auth-logout"),
  authDeviceStart: document.querySelector("#auth-device-start"),
  authDeviceCancel: document.querySelector("#auth-device-cancel"),
  authProfileForm: document.querySelector("#auth-profile-form"),
  authProfileId: document.querySelector("#auth-profile-id"),
  authProfileLabel: document.querySelector("#auth-profile-label"),
  authProfileApiKey: document.querySelector("#auth-profile-api-key"),
  authProfileApiKeyHint: document.querySelector("#auth-profile-api-key-hint"),
  authProfileNotes: document.querySelector("#auth-profile-notes"),
  authProfileList: document.querySelector("#auth-profile-list"),
  authProfileImportLocal: document.querySelector("#auth-profile-import-local"),
  authProfileClear: document.querySelector("#auth-profile-clear"),
  authProfileRemove: document.querySelector("#auth-profile-remove"),
  authBatchProfile: document.querySelector("#auth-batch-profile"),
  authBatchSummary: document.querySelector("#auth-batch-summary"),
  authBatchSelectAll: document.querySelector("#auth-batch-select-all"),
  authBatchTargetList: document.querySelector("#auth-batch-target-list"),
  authBatchApply: document.querySelector("#auth-batch-apply"),
  authBatchOutput: document.querySelector("#auth-batch-output"),
  composeForm: document.querySelector("#compose-form"),
  targetTemplate: document.querySelector("#target-card-template"),
  sessionTemplate: document.querySelector("#session-card-template")
};

function sshDetailInputs() {
  return [
    elements.targetSshHost,
    elements.targetSshUser,
    elements.targetSshPort,
    elements.targetSshLocalPort,
    elements.targetSshIdentityFile,
    elements.targetSshShellSetup,
    elements.targetSshCodexCommand
  ];
}

async function rpc(method, params = {}) {
  const response = await fetch("/rpc", {
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setBusy(label) {
  elements.statusPill.textContent = label;
  elements.statusPill.classList.add("status-pill", "busy");
}

function clearBusy(label = "Idle") {
  elements.statusPill.textContent = label;
  elements.statusPill.classList.remove("busy");
}

function showToast(message, isError = false) {
  const existing = document.querySelector(".toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.style.background = isError ? "rgba(159, 64, 61, 0.97)" : "rgba(11, 15, 16, 0.96)";
  toast.textContent = message;
  document.body.appendChild(toast);

  clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.remove(), 3200);
}

function showPanelMessage(message, isError = false) {
  elements.panelMessage.textContent = message;
  elements.panelMessage.className = `mb-3 rounded-md border px-3 py-2 text-[0.75rem] ${
    isError
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-sky-200 bg-sky-50 text-sky-700"
  }`;
}

function clearPanelMessage() {
  elements.panelMessage.textContent = "";
  elements.panelMessage.className = "hidden mb-3 rounded-md border px-3 py-2 text-[0.75rem]";
}

function setAuthOutput(text) {
  elements.authOutput.textContent = text || "Remote auth output will appear here.";
}

function setBatchOutput(text) {
  elements.authBatchOutput.textContent = text || "Batch apply results will appear here.";
}

function stopAuthPolling() {
  if (state.authPollTimer) {
    window.clearTimeout(state.authPollTimer);
    state.authPollTimer = null;
  }
}

function stopThreadPolling() {
  if (state.threadPollTimer) {
    window.clearTimeout(state.threadPollTimer);
    state.threadPollTimer = null;
  }
}

function setThreadStatus(message = "", tone = "") {
  if (!elements.threadStatusBanner) {
    return;
  }

  if (!message) {
    elements.threadStatusBanner.textContent = "";
    elements.threadStatusBanner.className = "thread-status-banner hidden";
    return;
  }

  elements.threadStatusBanner.textContent = message;
  elements.threadStatusBanner.className = `thread-status-banner ${tone || ""}`.trim();
}

function targetById(targetId) {
  return state.targets.find((item) => item.id === targetId) || null;
}

function authProfileById(profileId) {
  return state.authProfiles.find((item) => item.id === profileId) || null;
}

function sshTargets() {
  return state.targets.filter((target) => target.sshEnabled);
}

function selectedTarget() {
  return targetById(state.selectedTargetId) || null;
}

function tunnelByTargetId(targetId) {
  return state.tunnelsByTargetId[targetId] || targetById(targetId)?.tunnel || null;
}

function tunnelLabel(target) {
  const tunnel = tunnelByTargetId(target.id);
  if (!tunnel || !tunnel.enabled) {
    return "direct";
  }
  if (tunnel.connected) {
    return `ssh ready:${tunnel.localPort || "auto"}`;
  }
  return tunnel.status || "ssh idle";
}

function updateAuthTargetLabel() {
  const target = selectedTarget();
  if (!target) {
    elements.authTargetLabel.textContent = "Select a target with SSH enabled to manage remote login.";
    return;
  }

  elements.authTargetLabel.textContent = target.sshEnabled
    ? `Remote auth target: ${target.label}`
    : `${target.label} does not use SSH, so remote auth controls are unavailable.`;
}

function ensureSelectedSshTarget() {
  const target = selectedTarget();
  if (!target) {
    throw new Error("Select a target first.");
  }
  if (!target.sshEnabled) {
    throw new Error("The selected target does not have SSH enabled.");
  }
  return target;
}

function setComposeTarget(targetId) {
  state.selectedTargetId = targetId || "";
  elements.composeTarget.value = state.selectedTargetId;

  const target = targetById(state.selectedTargetId);
  elements.composeCwd.placeholder = target?.defaultCwd || "/srv/projects/proj1";
  elements.composeModel.placeholder = target?.defaultModel || "gpt-5.4";
  elements.composeApproval.placeholder = target?.defaultApprovalPolicy || "never";
  elements.composeSandbox.placeholder = target?.defaultSandbox || "workspace-write";

  if (!elements.composeCwd.value) {
    elements.composeCwd.value = target?.defaultCwd || "";
  }
  if (!elements.composeModel.value) {
    elements.composeModel.value = target?.defaultModel || "";
  }
  if (!elements.composeApproval.value) {
    elements.composeApproval.value = target?.defaultApprovalPolicy || "";
  }
  if (!elements.composeSandbox.value) {
    elements.composeSandbox.value = target?.defaultSandbox || "";
  }

  renderTargets();
  updateAuthTargetLabel();
}

function syncSshFieldState() {
  const enabled = Boolean(elements.targetSshEnabled.checked);
  elements.sshFields.classList.toggle("opacity-70", !enabled);
  for (const input of sshDetailInputs()) {
    input.disabled = !enabled;
  }
}

function resetTargetForm() {
  elements.targetHiddenId.value = "";
  elements.targetForm.reset();
  elements.targetSshEnabled.checked = false;
  syncSshFieldState();
  clearPanelMessage();
}

function populateTargetForm(target) {
  elements.targetHiddenId.value = target.id || "";
  elements.targetLabel.value = target.label || "";
  elements.targetIdInput.value = target.id || "";
  elements.targetUrl.value = target.url || "";
  elements.targetCwd.value = target.defaultCwd || "";
  elements.targetModel.value = target.defaultModel || "";
  elements.targetApproval.value = target.defaultApprovalPolicy || "";
  elements.targetSandbox.value = target.defaultSandbox || "";
  elements.targetNotes.value = target.notes || "";
  elements.targetSshEnabled.checked = Boolean(target.sshEnabled);
  elements.targetSshHost.value = target.sshHost || "";
  elements.targetSshUser.value = target.sshUser || "";
  elements.targetSshPort.value = target.sshPort || "";
  elements.targetSshLocalPort.value = target.sshLocalPort || "";
  elements.targetSshIdentityFile.value = target.sshIdentityFile || "";
  elements.targetSshShellSetup.value = target.sshShellSetup || "";
  elements.targetSshCodexCommand.value = target.sshCodexCommand || "";
  syncSshFieldState();
}

function resetAuthProfileForm() {
  elements.authProfileForm.reset();
  elements.authProfileId.value = "";
  state.selectedAuthProfileId = "";
  elements.authProfileApiKeyHint.textContent = "The key is stored in the local control-plane state file for batch apply.";
}

function populateAuthProfileForm(profile) {
  state.selectedAuthProfileId = profile.id;
  elements.authProfileId.value = profile.id;
  elements.authProfileLabel.value = profile.label || "";
  elements.authProfileApiKey.value = "";
  elements.authProfileNotes.value = profile.notes || "";
  if (profile.authType === "chatgpt_session") {
    elements.authProfileApiKeyHint.textContent = "This profile uses a bundled local Codex ChatGPT login snapshot. API Key is not required for apply.";
    return;
  }
  elements.authProfileApiKeyHint.textContent = profile.hasApiKey
    ? `Stored secret: ${profile.apiKeyMasked}. Leave API Key blank to keep the current secret.`
    : "Enter an API key to finish this profile.";
}

function renderTargetOptions() {
  elements.composeTarget.innerHTML = [
    `<option value="">Select a target</option>`,
    ...state.targets.map((target) => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.label)}</option>`)
  ].join("");

  if (state.selectedTargetId) {
    elements.composeTarget.value = state.selectedTargetId;
  }
}

function summarizeItem(item) {
  if (!item) {
    return "";
  }
  if (item.type === "userMessage") {
    return (item.content || []).map((entry) => entry.text || "").join("");
  }
  if (item.type === "agentMessage") {
    return item.text || "";
  }
  if (item.type === "reasoning") {
    return "Reasoning step completed.";
  }
  if (item.type === "commandExecution") {
    return item.command || "Command execution";
  }
  return JSON.stringify(item, null, 2);
}

function threadStatusType(thread) {
  return thread?.status?.type || thread?.status || "unknown";
}

function latestTurnStatus(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const latest = turns[turns.length - 1];
  return latest?.status?.type || latest?.status || "";
}

function threadIsRunning(thread) {
  const threadStatus = threadStatusType(thread);
  const turnStatus = latestTurnStatus(thread);
  return ["active", "inProgress", "pending", "running"].includes(threadStatus)
    || ["active", "inProgress", "pending", "running"].includes(turnStatus);
}

function threadHasAssistantMessage(thread, assistantMessages = []) {
  if (assistantMessages.length > 0) {
    return true;
  }

  return (thread?.turns || [])
    .flatMap((turn) => turn.items || [])
    .some((item) => item.type === "agentMessage" && item.text);
}

function renderTargets() {
  renderTargetOptions();

  if (state.targets.length === 0) {
    elements.targetList.innerHTML = `<div class="rounded-md border border-outline-variant/20 bg-surface-container-lowest p-3 text-[0.8125rem] text-on-surface-variant">No targets yet. Add a remote App Server endpoint to get started.</div>`;
    return;
  }

  elements.targetList.innerHTML = "";

  for (const target of state.targets) {
    const fragment = elements.targetTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".list-card");
    const tunnel = tunnelByTargetId(target.id) || target.tunnel || null;
    const badge = card.querySelector(".badge");
    const connectButton = card.querySelector('[data-action="connect"]');
    const disconnectButton = card.querySelector('[data-action="disconnect"]');

    if (state.selectedTargetId === target.id) {
      card.classList.add("is-selected");
    }

    card.querySelector(".card-title").textContent = target.label;
    card.querySelector(".card-subtitle").textContent = target.sshEnabled
      ? `${target.id} · ${target.sshUser ? `${target.sshUser}@` : ""}${target.sshHost || "ssh host not set"}`
      : `${target.id} · ${target.url}`;
    badge.textContent = tunnelLabel(target);

    card.querySelector(".meta-grid").innerHTML = [
      ["endpoint", target.url || "not set"],
      ["cwd", target.defaultCwd || "not set"],
      ["model", target.defaultModel || "not set"],
      ["approval", target.defaultApprovalPolicy || "not set"],
      ["sandbox", target.defaultSandbox || "not set"],
      ["local", tunnel?.localUrl || "not connected"]
    ].map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("");

    connectButton.hidden = !target.sshEnabled;
    disconnectButton.hidden = !target.sshEnabled;

    card.querySelector('[data-action="edit"]').addEventListener("click", () => {
      populateTargetForm(target);
      showPanelMessage(`Editing target ${target.label}.`);
    });

    connectButton.addEventListener("click", async () => {
      try {
        setBusy("Opening SSH tunnel");
        const result = await rpc("target_connect", { targetId: target.id });
        await refreshAll();
        showPanelMessage(`SSH tunnel ready at ${result.connection.tunnel.localHost}:${result.connection.tunnel.localPort}.`);
        showToast(`SSH tunnel ready for ${target.label}.`);
      } catch (error) {
        showPanelMessage(error.message, true);
        showToast(error.message, true);
      } finally {
        clearBusy();
      }
    });

    disconnectButton.addEventListener("click", async () => {
      try {
        setBusy("Closing SSH tunnel");
        await rpc("target_disconnect", { targetId: target.id });
        await refreshAll();
        showPanelMessage(`Disconnected SSH tunnel for ${target.label}.`);
        showToast(`Disconnected ${target.label}.`);
      } catch (error) {
        showPanelMessage(error.message, true);
        showToast(error.message, true);
      } finally {
        clearBusy();
      }
    });

    card.querySelector('[data-action="probe"]').addEventListener("click", async () => {
      try {
        setBusy("Probing target");
        const result = await rpc("target_probe", { targetId: target.id });
        const route = result.connection?.clientUrl || result.target?.url || target.url;
        await refreshAll();
        showPanelMessage(`Connected to ${target.label} via ${route}.`);
        showToast(`Connected to ${target.label}.`);
      } catch (error) {
        showPanelMessage(error.message, true);
        showToast(error.message, true);
      } finally {
        clearBusy();
      }
    });

    card.querySelector('[data-action="compose"]').addEventListener("click", () => {
      setComposeTarget(target.id);
      elements.detailTitle.textContent = `Compose on ${target.label}`;
      elements.detailBreadcrumb.textContent = target.label;
      showPanelMessage(`Target ${target.label} is selected for the next turn.`);
    });

    card.querySelector('[data-action="remove"]').addEventListener("click", async () => {
      if (!window.confirm(`Remove ${target.label} and its local sessions?`)) {
        return;
      }

      try {
        setBusy("Removing target");
        await rpc("target_remove", { targetId: target.id });
        if (state.selectedTargetId === target.id) {
          setComposeTarget("");
        }
        state.batchTargetIds = state.batchTargetIds.filter((item) => item !== target.id);
        await refreshAll();
        showPanelMessage(`Removed ${target.label}.`);
        showToast(`Removed ${target.label}.`);
      } catch (error) {
        showPanelMessage(error.message, true);
        showToast(error.message, true);
      } finally {
        clearBusy();
      }
    });

    elements.targetList.appendChild(fragment);
  }
}

function renderSessions() {
  if (state.sessions.length === 0) {
    elements.sessionList.innerHTML = `<div class="rounded-md border border-outline-variant/20 bg-surface-container-lowest p-3 text-[0.8125rem] text-on-surface-variant">No local session snapshots yet. Start a new thread to populate this list.</div>`;
    return;
  }

  elements.sessionList.innerHTML = "";

  for (const session of state.sessions) {
    const fragment = elements.sessionTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".list-card");
    card.querySelector(".card-title").textContent = session.targetLabel || session.targetId;
    card.querySelector(".card-subtitle").textContent = session.threadId;
    card.querySelector(".badge").textContent = session.lastTurnStatus || session.status || "idle";
    card.querySelector(".session-preview").textContent = session.lastAssistantMessage || session.preview || "No assistant output captured yet.";
    card.querySelector(".meta-grid").innerHTML = [
      ["cwd", session.cwd || "unknown"],
      ["model", session.model || "unknown"],
      ["updated", session.updatedAt || "unknown"]
    ].map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("");

    card.querySelector('[data-action="open"]').addEventListener("click", () => {
      loadThread(session.targetId, session.threadId);
    });

    card.querySelector('[data-action="continue"]').addEventListener("click", () => {
      setComposeTarget(session.targetId);
      elements.composeThreadId.value = session.threadId;
      elements.detailTitle.textContent = `Continue ${session.threadId}`;
      elements.detailBreadcrumb.textContent = session.targetLabel || session.targetId;
      elements.composePrompt.focus();
    });

    elements.sessionList.appendChild(fragment);
  }
}

function renderThread(thread, assistantMessages = []) {
  state.activeThread = thread || null;
  state.selectedThreadId = thread?.id || "";
  elements.composeThreadId.value = state.selectedThreadId;
  stopThreadPolling();

  if (!thread) {
    elements.detailBreadcrumb.textContent = state.selectedTargetId || "No active thread";
    elements.detailMeta.innerHTML = "<span>No thread selected.</span>";
    elements.assistantOutput.textContent = "Run a thread to see the final assistant message here.";
    elements.threadTurns.innerHTML = "Thread history will appear here.";
    setThreadStatus("");
    return;
  }

  elements.detailTitle.textContent = thread.name || thread.preview || thread.id;
  elements.detailBreadcrumb.textContent = state.selectedTargetId || "Active thread";
  elements.detailMeta.innerHTML = [
    `<span><strong>Thread:</strong> ${escapeHtml(thread.id)}</span>`,
    `<span><strong>CWD:</strong> ${escapeHtml(thread.cwd || "unknown")}</span>`,
    `<span><strong>Status:</strong> ${escapeHtml(thread.status?.type || thread.status || "unknown")}</span>`
  ].join(" · ");

  const finalMessages = assistantMessages.length > 0
    ? assistantMessages
    : (thread.turns || [])
      .flatMap((turn) => turn.items || [])
      .filter((item) => item.type === "agentMessage")
      .map((item) => item.text || "")
      .filter(Boolean);

  const hasAssistantOutput = finalMessages.length > 0;
  elements.assistantOutput.textContent = finalMessages.join("\n\n") || "No assistant message found in this thread yet.";

  if (threadIsRunning(thread) && !hasAssistantOutput) {
    setThreadStatus(`Thread ${thread.id} is running on the remote server. This page is polling automatically for the next Codex response.`, "running");
    state.threadPollTimer = window.setTimeout(() => {
      loadThread(state.selectedTargetId, thread.id, false, true).catch((error) => {
        setThreadStatus(`Polling failed: ${error.message}`, "error");
      });
    }, 3500);
  } else if (hasAssistantOutput) {
    setThreadStatus(`Latest Codex response loaded for ${thread.id}.`, "completed");
  } else {
    setThreadStatus(`Thread ${thread.id} has no assistant output yet. Refresh again if the remote server is still processing.`, "running");
  }

  if (!Array.isArray(thread.turns) || thread.turns.length === 0) {
    elements.threadTurns.textContent = "This thread has no turn history yet.";
    return;
  }

  elements.threadTurns.innerHTML = thread.turns.map((turn, index) => {
    const items = (turn.items || []).map((item) => `
      <div class="timeline-item">
        <div class="timeline-item-label">${escapeHtml(item.type)}</div>
        <div>${escapeHtml(summarizeItem(item))}</div>
      </div>
    `).join("");

    return `
      <article class="timeline-turn">
        <p class="inline-note">Turn ${index + 1} · ${escapeHtml(turn.id)} · ${escapeHtml(turn.status?.type || turn.status || "unknown")}</p>
        ${items || '<div class="timeline-item"><div>No items on this turn.</div></div>'}
      </article>
    `;
  }).join("");
}

function renderRemoteThreads(threads) {
  if (!threads || threads.length === 0) {
    elements.remoteThreadList.innerHTML = `<div class="rounded-md border border-outline-variant/20 bg-surface-container-lowest p-3 text-[0.8125rem] text-on-surface-variant">No remote threads returned for this target.</div>`;
    return;
  }

  elements.remoteThreadList.innerHTML = threads.map((thread) => `
    <article class="list-card p-3 bg-surface-container-lowest rounded-md border border-outline-variant/10">
      <div class="list-card-top">
        <div>
          <h3 class="card-title text-[0.875rem] font-medium text-on-surface">${escapeHtml(thread.preview || thread.id)}</h3>
          <p class="card-subtitle text-[0.75rem] text-on-surface-variant">${escapeHtml(thread.id)}</p>
        </div>
        <span class="badge bg-surface-variant text-on-surface-variant text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-tighter">${escapeHtml(thread.status?.type || "unknown")}</span>
      </div>
      <dl class="meta-grid text-[0.75rem] mt-2">
        <dt>cwd</dt><dd>${escapeHtml(thread.cwd || "unknown")}</dd>
        <dt>updated</dt><dd>${escapeHtml(String(thread.updatedAt || ""))}</dd>
      </dl>
      <div class="card-actions mt-3 flex flex-wrap gap-2">
        <button class="px-2.5 py-1.5 text-[0.75rem] rounded-md border border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low transition-colors" data-open-thread="${escapeHtml(thread.id)}" type="button">Open</button>
      </div>
    </article>
  `).join("");

  elements.remoteThreadList.querySelectorAll("[data-open-thread]").forEach((button) => {
    button.addEventListener("click", () => {
      loadThread(state.selectedTargetId, button.dataset.openThread);
    });
  });
}

function renderAuthProfiles() {
  if (state.authProfiles.length === 0) {
    elements.authProfileList.innerHTML = `<div class="rounded-md border border-outline-variant/20 bg-surface-container-lowest p-3 text-[0.8125rem] text-on-surface-variant">No auth profiles yet. Save one profile to enable batch switching.</div>`;
    return;
  }

  elements.authProfileList.innerHTML = state.authProfiles.map((profile) => `
    <article class="profile-row ${state.selectedAuthProfileId === profile.id ? "is-selected" : ""}">
      <div class="profile-row-main">
        <div class="text-[0.8125rem] font-semibold text-on-surface">${escapeHtml(profile.label)}</div>
        <div class="masked-secret mt-1">${escapeHtml(profile.authType === "chatgpt_session" ? "ChatGPT session bundle" : (profile.apiKeyMasked || "No key stored"))}</div>
        <div class="compact-note mt-1">${escapeHtml(profile.notes || "No notes")}</div>
      </div>
      <div class="flex flex-col gap-2 shrink-0">
        <button class="px-2.5 py-1.5 text-[0.75rem] rounded-md border border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low transition-colors" data-auth-profile-edit="${escapeHtml(profile.id)}" type="button">Edit</button>
        <button class="px-2.5 py-1.5 text-[0.75rem] rounded-md border border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low transition-colors" data-auth-profile-select="${escapeHtml(profile.id)}" type="button">Use</button>
      </div>
    </article>
  `).join("");

  elements.authProfileList.querySelectorAll("[data-auth-profile-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const profile = authProfileById(button.dataset.authProfileEdit);
      if (profile) {
        populateAuthProfileForm(profile);
        renderAuthProfiles();
        renderBatchProfileOptions();
      }
    });
  });

  elements.authProfileList.querySelectorAll("[data-auth-profile-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAuthProfileId = button.dataset.authProfileSelect;
      renderAuthProfiles();
      renderBatchProfileOptions();
      showPanelMessage(`Selected auth profile ${authProfileById(state.selectedAuthProfileId)?.label || state.selectedAuthProfileId}.`);
    });
  });
}

function renderBatchProfileOptions() {
  elements.authBatchProfile.innerHTML = [
    `<option value="">Select a profile</option>`,
    ...state.authProfiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)}</option>`)
  ].join("");

  if (state.selectedAuthProfileId) {
    elements.authBatchProfile.value = state.selectedAuthProfileId;
  }
}

function updateBatchSummary() {
  const total = sshTargets().length;
  const selected = state.batchTargetIds.length;
  elements.authBatchSummary.textContent = total === 0
    ? "No SSH targets available for batch apply."
    : `${selected} of ${total} SSH targets selected for batch apply.`;
  elements.authBatchSelectAll.textContent = selected === total && total > 0 ? "Clear All" : "Select All";
}

function renderBatchTargets() {
  const targets = sshTargets();
  state.batchTargetIds = state.batchTargetIds.filter((targetId) => targets.some((target) => target.id === targetId));
  updateBatchSummary();

  if (targets.length === 0) {
    elements.authBatchTargetList.innerHTML = `<div class="rounded-md border border-outline-variant/20 bg-surface-container-lowest p-3 text-[0.8125rem] text-on-surface-variant">Add an SSH-enabled target to batch-apply credentials.</div>`;
    return;
  }

  elements.authBatchTargetList.innerHTML = targets.map((target) => {
    const selected = state.batchTargetIds.includes(target.id);
    const tunnel = tunnelByTargetId(target.id) || target.tunnel || null;
    return `
      <label class="batch-target-row ${selected ? "is-selected" : ""}">
        <input class="mt-1 rounded border-outline-variant/40 text-primary focus:ring-primary" data-batch-target="${escapeHtml(target.id)}" type="checkbox" ${selected ? "checked" : ""} />
        <div class="batch-target-main">
          <div class="text-[0.8125rem] font-semibold text-on-surface">${escapeHtml(target.label)}</div>
          <div class="compact-note mt-1">${escapeHtml(target.sshUser ? `${target.sshUser}@` : "")}${escapeHtml(target.sshHost || "")} · ${escapeHtml(target.url || "")}</div>
          <div class="compact-note mt-1">Tunnel: ${escapeHtml(tunnel?.localUrl || "not connected")}</div>
        </div>
      </label>
    `;
  }).join("");

  elements.authBatchTargetList.querySelectorAll("[data-batch-target]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (!state.batchTargetIds.includes(checkbox.dataset.batchTarget)) {
          state.batchTargetIds.push(checkbox.dataset.batchTarget);
        }
      } else {
        state.batchTargetIds = state.batchTargetIds.filter((item) => item !== checkbox.dataset.batchTarget);
      }
      renderBatchTargets();
    });
  });
}

function formatBatchApplyResults(result) {
  const header = `Profile ${result.profile.label} applied to ${result.results.length} target(s).`;
  const lines = result.results.map((entry) => {
    if (!entry.ok) {
      return `[FAILED] ${entry.targetLabel} (${entry.targetId})\n${entry.error}`;
    }

    return [
      `[OK] ${entry.targetLabel} (${entry.targetId})`,
      entry.loginOutput || "",
      entry.status || ""
    ].filter(Boolean).join("\n");
  });

  return [header, ...lines].join("\n\n");
}

async function refreshDashboard() {
  const [health, sessionResult, targetResult, tunnelResult, authProfileResult] = await Promise.all([
    rpc("control_health"),
    rpc("session_list", { limit: 20 }),
    rpc("target_list"),
    rpc("tunnel_list"),
    rpc("auth_profile_list")
  ]);

  state.sessions = sessionResult.sessions || [];
  state.targets = targetResult.targets || [];
  state.authProfiles = authProfileResult.profiles || [];
  state.tunnelsByTargetId = Object.fromEntries(
    (tunnelResult.tunnels || []).map((tunnel) => [tunnel.targetId, tunnel])
  );

  if (state.selectedTargetId && !targetById(state.selectedTargetId)) {
    state.selectedTargetId = "";
  }
  if (state.selectedAuthProfileId && !authProfileById(state.selectedAuthProfileId)) {
    state.selectedAuthProfileId = "";
  }

  elements.metricStatus.textContent = health.status;
  elements.metricEndpoint.textContent = `${health.host}:${health.port} · ${health.tunnels || 0} ssh · ${health.authProfiles || 0} profiles`;
  elements.metricTargets.textContent = String(state.targets.length);
  elements.metricSessions.textContent = String(state.sessions.length);
  elements.metricTunnels.textContent = String(health.tunnels || 0);

  updateAuthTargetLabel();
}

async function refreshAll() {
  try {
    setBusy("Refreshing");
    await refreshDashboard();
    renderTargets();
    renderSessions();
    renderAuthProfiles();
    renderBatchProfileOptions();
    renderBatchTargets();

    if (state.selectedTargetId) {
      setComposeTarget(state.selectedTargetId);
    }

    if (state.selectedThreadId && state.selectedTargetId) {
      await loadThread(state.selectedTargetId, state.selectedThreadId, false);
    } else {
      renderThread(null);
    }
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

async function loadThread(targetId, threadId, toastOnSuccess = true, backgroundPoll = false) {
  if (!targetId || !threadId) {
    showPanelMessage("Select a target and thread first.", true);
    showToast("Select a target and thread first.", true);
    return;
  }

  try {
    if (!backgroundPoll) {
      setBusy("Loading thread");
    }
    const result = await rpc("thread_read", {
      targetId,
      threadId,
      includeTurns: true
    });

    setComposeTarget(targetId);
    renderThread(result.thread, result.assistantMessages || []);
    await refreshDashboard();
    renderSessions();
    renderAuthProfiles();
    renderBatchProfileOptions();
    renderBatchTargets();
    if (!backgroundPoll) {
      showPanelMessage(`Loaded thread ${threadId}.`);
    }
    if (toastOnSuccess && !backgroundPoll) {
      showToast(`Loaded thread ${threadId}.`);
    }
  } catch (error) {
    if (!backgroundPoll) {
      showPanelMessage(error.message, true);
      showToast(error.message, true);
    } else {
      setThreadStatus(`Polling failed: ${error.message}`, "error");
    }
  } finally {
    if (!backgroundPoll) {
      clearBusy();
    }
  }
}

async function browseRemoteThreads() {
  if (!state.selectedTargetId) {
    showPanelMessage("Pick a target before browsing remote threads.", true);
    showToast("Pick a target before browsing remote threads.", true);
    return;
  }

  try {
    setBusy("Listing remote threads");
    showPanelMessage(`Loading remote thread index for ${state.selectedTargetId}...`);
    const result = await rpc("thread_list", {
      targetId: state.selectedTargetId,
      limit: 12
    });
    renderRemoteThreads(result.threads || result.data || result.items || []);
    showPanelMessage(`Loaded remote thread index for ${state.selectedTargetId}.`);
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

async function readAuthJob(jobId) {
  const result = await rpc("remote_auth_job_read", { jobId });
  const stdout = result.job.stdout || "";
  const stderr = result.job.stderr || "";
  setAuthOutput([stdout, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n\n"));

  if (result.job.status === "running") {
    state.authPollTimer = window.setTimeout(() => {
      readAuthJob(jobId).catch((error) => {
        setAuthOutput(error.message);
        stopAuthPolling();
      });
    }, 2000);
    return;
  }

  stopAuthPolling();
}

async function handleTargetSave(event) {
  event.preventDefault();

  if (!elements.targetUrl.value.trim()) {
    showPanelMessage("WebSocket URL is required.", true);
    showToast("WebSocket URL is required.", true);
    return;
  }

  if (elements.targetSshEnabled.checked && !elements.targetSshHost.value.trim()) {
    showPanelMessage("SSH host is required when built-in SSH is enabled.", true);
    showToast("SSH host is required when built-in SSH is enabled.", true);
    return;
  }

  try {
    setBusy("Saving target");
    clearPanelMessage();
    await rpc("target_upsert", {
      id: elements.targetIdInput.value.trim() || elements.targetHiddenId.value.trim() || undefined,
      label: elements.targetLabel.value.trim(),
      url: elements.targetUrl.value.trim(),
      defaultCwd: elements.targetCwd.value.trim(),
      defaultModel: elements.targetModel.value.trim(),
      defaultApprovalPolicy: elements.targetApproval.value.trim(),
      defaultSandbox: elements.targetSandbox.value.trim(),
      notes: elements.targetNotes.value.trim(),
      sshEnabled: elements.targetSshEnabled.checked,
      sshHost: elements.targetSshHost.value.trim(),
      sshUser: elements.targetSshUser.value.trim(),
      sshPort: elements.targetSshPort.value.trim(),
      sshLocalPort: elements.targetSshLocalPort.value.trim(),
      sshIdentityFile: elements.targetSshIdentityFile.value.trim(),
      sshShellSetup: elements.targetSshShellSetup.value.trim(),
      sshCodexCommand: elements.targetSshCodexCommand.value.trim()
    });

    resetTargetForm();
    await refreshAll();
    showPanelMessage("Target saved.");
    showToast("Target saved.");
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

async function handleComposeSubmit(event) {
  event.preventDefault();

  if (!elements.composeTarget.value) {
    showPanelMessage("Choose a target first.", true);
    showToast("Choose a target first.", true);
    return;
  }

  if (!elements.composePrompt.value.trim()) {
    showPanelMessage("Prompt cannot be empty.", true);
    showToast("Prompt cannot be empty.", true);
    return;
  }

  try {
    setBusy("Running remote turn");
    showPanelMessage("Starting remote turn. This may take a while; the thread will be created immediately.");
    setThreadStatus("Sending your request to the remote Codex server...", "running");
    const params = {
      targetId: elements.composeTarget.value,
      threadId: elements.composeThreadId.value.trim() || undefined,
      cwd: elements.composeCwd.value.trim() || undefined,
      model: elements.composeModel.value.trim() || undefined,
      approvalPolicy: elements.composeApproval.value.trim() || undefined,
      sandbox: elements.composeSandbox.value.trim() || undefined,
      prompt: elements.composePrompt.value.trim(),
      waitForCompletion: false
    };

    const result = params.threadId
      ? await rpc("turn_start", params)
      : await rpc("thread_start", params);

    setComposeTarget(result.target.id);
    renderThread(result.thread || null, result.assistantMessages || []);
    if (result.thread?.id) {
      state.selectedThreadId = result.thread.id;
      elements.composeThreadId.value = result.thread.id;
      setThreadStatus(`Thread ${result.thread.id} created. Waiting for the remote Codex server to answer...`, "running");
      await loadThread(result.target.id, result.thread.id, false);
    }
    elements.composePrompt.value = "";
    await refreshDashboard();
    renderTargets();
    renderSessions();
    renderAuthProfiles();
    renderBatchProfileOptions();
    renderBatchTargets();
    showPanelMessage("Remote turn started. This page will keep polling the current thread.");
    showToast("Remote turn started.");
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
    setThreadStatus(error.message, "error");
  } finally {
    clearBusy();
  }
}

async function handleAuthProfileSave(event) {
  event.preventDefault();

  if (!elements.authProfileLabel.value.trim()) {
    showPanelMessage("Profile label is required.", true);
    showToast("Profile label is required.", true);
    return;
  }

  const editingId = elements.authProfileId.value.trim();
  const payload = {
    id: editingId || undefined,
    label: elements.authProfileLabel.value.trim(),
    notes: elements.authProfileNotes.value.trim()
  };

  if (elements.authProfileApiKey.value.trim()) {
    payload.apiKey = elements.authProfileApiKey.value.trim();
  } else if (!editingId) {
    showPanelMessage("API key is required when creating a new profile.", true);
    showToast("API key is required when creating a new profile.", true);
    return;
  }

  try {
    setBusy("Saving auth profile");
    const result = await rpc("auth_profile_upsert", payload);
    state.selectedAuthProfileId = result.profile.id;
    await refreshDashboard();
    const profile = authProfileById(result.profile.id) || result.profile;
    populateAuthProfileForm(profile);
    renderAuthProfiles();
    renderBatchProfileOptions();
    showPanelMessage(`Saved auth profile ${result.profile.label}.`);
    showToast(`Saved auth profile ${result.profile.label}.`);
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

async function handleAuthProfileRemove() {
  const profileId = elements.authProfileId.value.trim() || state.selectedAuthProfileId;
  const profile = authProfileById(profileId);
  if (!profileId || !profile) {
    showPanelMessage("Select a profile to remove.", true);
    showToast("Select a profile to remove.", true);
    return;
  }

  if (!window.confirm(`Remove auth profile ${profile.label}?`)) {
    return;
  }

  try {
    setBusy("Removing auth profile");
    await rpc("auth_profile_remove", { profileId });
    resetAuthProfileForm();
    await refreshAll();
    showPanelMessage(`Removed auth profile ${profile.label}.`);
    showToast(`Removed auth profile ${profile.label}.`);
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

async function handleImportLocalAuthProfile() {
  try {
    setBusy("Importing local login");
    const result = await rpc("auth_profile_import_local", {
      id: elements.authProfileId.value.trim() || undefined,
      label: elements.authProfileLabel.value.trim() || undefined,
      notes: elements.authProfileNotes.value.trim() || undefined
    });
    state.selectedAuthProfileId = result.profile.id;
    await refreshDashboard();
    const profile = authProfileById(result.profile.id) || result.profile;
    populateAuthProfileForm(profile);
    renderAuthProfiles();
    renderBatchProfileOptions();
    showPanelMessage(`Imported current local Codex login as ${result.profile.label}.`);
    showToast(`Imported current local Codex login as ${result.profile.label}.`);
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

async function handleBatchApply() {
  const profileId = elements.authBatchProfile.value || state.selectedAuthProfileId;
  if (!profileId) {
    showPanelMessage("Choose an auth profile before batch apply.", true);
    showToast("Choose an auth profile before batch apply.", true);
    return;
  }
  if (state.batchTargetIds.length === 0) {
    showPanelMessage("Select at least one SSH target before batch apply.", true);
    showToast("Select at least one SSH target before batch apply.", true);
    return;
  }

  try {
    setBusy("Applying auth profile");
    setBatchOutput("Applying auth profile to selected targets...");
    const result = await rpc("auth_profile_apply", {
      profileId,
      targetIds: [...state.batchTargetIds]
    });
    setBatchOutput(formatBatchApplyResults(result));
    await refreshDashboard();
    renderTargets();
    renderAuthProfiles();
    renderBatchProfileOptions();
    renderBatchTargets();
    showPanelMessage(`Applied ${result.profile.label} to ${state.batchTargetIds.length} target(s).`);
    showToast(`Applied ${result.profile.label} to selected targets.`);
  } catch (error) {
    setBatchOutput(error.message);
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
}

elements.targetForm.addEventListener("submit", handleTargetSave);
elements.composeForm.addEventListener("submit", handleComposeSubmit);
elements.authProfileForm.addEventListener("submit", handleAuthProfileSave);
elements.targetSshEnabled.addEventListener("change", syncSshFieldState);
elements.composeTarget.addEventListener("change", () => {
  setComposeTarget(elements.composeTarget.value);
});
elements.authProfileImportLocal.addEventListener("click", handleImportLocalAuthProfile);
elements.authProfileClear.addEventListener("click", () => {
  resetAuthProfileForm();
  renderAuthProfiles();
  renderBatchProfileOptions();
});
elements.authProfileRemove.addEventListener("click", handleAuthProfileRemove);
elements.authBatchProfile.addEventListener("change", () => {
  state.selectedAuthProfileId = elements.authBatchProfile.value;
  renderAuthProfiles();
});
elements.authBatchSelectAll.addEventListener("click", () => {
  const targets = sshTargets();
  const allSelected = targets.length > 0 && state.batchTargetIds.length === targets.length;
  state.batchTargetIds = allSelected ? [] : targets.map((target) => target.id);
  renderBatchTargets();
});
elements.authBatchApply.addEventListener("click", handleBatchApply);

document.querySelector("#refresh-all").addEventListener("click", refreshAll);
document.querySelector("#refresh-sessions").addEventListener("click", async () => {
  try {
    setBusy("Refreshing sessions");
    const result = await rpc("session_list", { limit: 20 });
    state.sessions = result.sessions || [];
    renderSessions();
  } catch (error) {
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
});
document.querySelector("#clear-target").addEventListener("click", resetTargetForm);
document.querySelector("#new-target").addEventListener("click", resetTargetForm);
document.querySelector("#refresh-thread").addEventListener("click", () => {
  loadThread(state.selectedTargetId, state.selectedThreadId);
});
document.querySelector("#load-remote-threads").addEventListener("click", browseRemoteThreads);

elements.authStatus.addEventListener("click", async () => {
  try {
    const target = ensureSelectedSshTarget();
    setBusy("Checking auth");
    const result = await rpc("remote_auth_status", { targetId: target.id });
    setAuthOutput(result.status);
    showPanelMessage(`Fetched remote auth status for ${target.label}.`);
  } catch (error) {
    setAuthOutput(error.message);
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
});

elements.authLogout.addEventListener("click", async () => {
  try {
    const target = ensureSelectedSshTarget();
    setBusy("Logging out");
    const result = await rpc("remote_auth_logout", { targetId: target.id });
    setAuthOutput(result.output);
    showPanelMessage(`Logged out ${target.label} on the remote server.`);
    showToast(`Logged out ${target.label}.`);
  } catch (error) {
    setAuthOutput(error.message);
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
});

elements.authDeviceStart.addEventListener("click", async () => {
  try {
    const target = ensureSelectedSshTarget();
    stopAuthPolling();
    setBusy("Starting device login");
    const result = await rpc("remote_auth_start_device", { targetId: target.id });
    state.authJobId = result.job.id;
    setAuthOutput("Waiting for remote device-auth instructions...");
    await readAuthJob(state.authJobId);
    showPanelMessage(`Started remote device login for ${target.label}.`);
    showToast(`Started remote device login for ${target.label}.`);
  } catch (error) {
    setAuthOutput(error.message);
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
});

elements.authDeviceCancel.addEventListener("click", async () => {
  if (!state.authJobId) {
    setAuthOutput("No running remote auth job.");
    return;
  }

  try {
    setBusy("Cancelling login");
    const result = await rpc("remote_auth_job_cancel", { jobId: state.authJobId });
    state.authJobId = "";
    stopAuthPolling();
    setAuthOutput([result.job.stdout, result.job.stderr].filter(Boolean).join("\n\n") || "Remote auth job cancelled.");
    showPanelMessage("Cancelled remote device login.");
  } catch (error) {
    setAuthOutput(error.message);
    showPanelMessage(error.message, true);
    showToast(error.message, true);
  } finally {
    clearBusy();
  }
});

resetTargetForm();
resetAuthProfileForm();
elements.composeForm.reset();
syncSshFieldState();
updateAuthTargetLabel();
setAuthOutput("");
setBatchOutput("");
refreshAll();
