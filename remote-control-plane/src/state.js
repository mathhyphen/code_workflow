const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createEmptyState() {
  const now = nowIso();

  return {
    createdAt: now,
    updatedAt: now,
    counters: {
      target: 0,
      authProfile: 0
    },
    targets: [],
    authProfiles: [],
    sessions: []
  };
}

function readString(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized || fallback;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
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

function normalizeTarget(input, fallbackId) {
  const now = nowIso();

  return {
    id: readString(input.id, fallbackId),
    label: readString(input.label, "Unnamed target"),
    url: readString(input.url, ""),
    defaultCwd: readString(input.defaultCwd || input.cwd),
    defaultModel: readString(input.defaultModel || input.model),
    defaultApprovalPolicy: readString(input.defaultApprovalPolicy || input.approvalPolicy),
    defaultSandbox: readString(input.defaultSandbox || input.sandbox),
    notes: readString(input.notes, ""),
    sshEnabled: readBoolean(input.sshEnabled, false),
    sshHost: readString(input.sshHost, ""),
    sshPort: readString(input.sshPort, ""),
    sshUser: readString(input.sshUser, ""),
    sshLocalPort: readString(input.sshLocalPort, ""),
    sshIdentityFile: readString(input.sshIdentityFile, ""),
    sshShellSetup: readString(input.sshShellSetup, ""),
    sshCodexCommand: readString(input.sshCodexCommand, ""),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

function maskApiKey(apiKey) {
  const value = readString(apiKey, "");
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function normalizeAuthProfile(input, fallbackId, previous = null) {
  const now = nowIso();
  const authType = readString(input.authType, previous?.authType || "api_key");
  const apiKey = Object.prototype.hasOwnProperty.call(input, "apiKey")
    ? readString(input.apiKey, "")
    : previous?.apiKey || "";

  return {
    id: readString(input.id, fallbackId),
    label: readString(input.label, previous?.label || "Unnamed profile"),
    authType,
    apiKey,
    notes: readString(input.notes, previous?.notes || ""),
    authMode: readString(input.authMode, previous?.authMode || ""),
    authJsonPath: readString(input.authJsonPath, previous?.authJsonPath || ""),
    capSidPath: readString(input.capSidPath, previous?.capSidPath || ""),
    createdAt: previous?.createdAt || input.createdAt || now,
    updatedAt: now
  };
}

function sanitizeAuthProfile(profile) {
  return {
    id: profile.id,
    label: profile.label,
    authType: profile.authType || "api_key",
    notes: profile.notes || "",
    authMode: profile.authMode || "",
    hasApiKey: Boolean(profile.apiKey),
    apiKeyMasked: maskApiKey(profile.apiKey),
    hasAuthFiles: Boolean(profile.authJsonPath),
    authJsonPath: profile.authJsonPath || "",
    capSidPath: profile.capSidPath || "",
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

class ControlPlaneState {
  constructor(filePath, logger) {
    this.filePath = path.resolve(filePath);
    this.authProfilesDir = path.join(path.dirname(this.filePath), "auth-profiles");
    this.logger = logger;
    this.state = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        const empty = createEmptyState();
        this.saveState(empty);
        return empty;
      }

      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const empty = createEmptyState();
      const nextState = {
        ...empty,
        ...parsed,
        counters: {
          ...empty.counters,
          ...(parsed.counters || {})
        },
        targets: Array.isArray(parsed.targets) ? parsed.targets : [],
        authProfiles: [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      };

      this.migrateLegacyAuthProfiles(Array.isArray(parsed.authProfiles) ? parsed.authProfiles : []);
      this.saveState(nextState);
      return nextState;
    } catch (error) {
      this.logger.warn("State file unreadable. Reinitializing empty state.", {
        filePath: this.filePath,
        error: error.message
      });
      const empty = createEmptyState();
      this.saveState(empty);
      return empty;
    }
  }

  migrateLegacyAuthProfiles(profiles) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return;
    }

    ensureDir(this.authProfilesDir);

    for (const profile of profiles) {
      const profileId = readString(profile.id);
      if (!profileId) {
        continue;
      }

      const manifestPath = this.profileManifestPath(profileId);
      if (fs.existsSync(manifestPath)) {
        continue;
      }

      const normalized = normalizeAuthProfile(profile, profileId);
      ensureDir(this.profileDir(profileId));
      fs.writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    }
  }

  saveState(state) {
    ensureParentDir(this.filePath);
    fs.writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  persist() {
    this.state.updatedAt = nowIso();
    this.saveState(this.state);
  }

  snapshot() {
    return clone(this.state);
  }

  profileDir(profileId) {
    return path.join(this.authProfilesDir, profileId);
  }

  profileManifestPath(profileId) {
    return path.join(this.profileDir(profileId), "profile.json");
  }

  listAuthProfileIds() {
    ensureDir(this.authProfilesDir);
    return fs.readdirSync(this.authProfilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(this.profileManifestPath(entry.name)))
      .map((entry) => entry.name);
  }

  readAuthProfileFile(profileId) {
    const manifestPath = this.profileManifestPath(profileId);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Auth profile not found: ${profileId}`);
    }

    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return normalizeAuthProfile(parsed, profileId, parsed);
  }

  writeAuthProfileFile(profile) {
    ensureDir(this.profileDir(profile.id));
    fs.writeFileSync(this.profileManifestPath(profile.id), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  }

  upsertTarget(input) {
    if (!input || typeof input !== "object") {
      throw new Error("target_upsert requires an object payload.");
    }

    const targetId = readString(input.id) || `target-${String(++this.state.counters.target).padStart(4, "0")}`;
    const normalized = normalizeTarget(input, targetId);

    if (!normalized.url) {
      throw new Error("Target url is required.");
    }

    const existingIndex = this.state.targets.findIndex((target) => target.id === targetId);
    if (existingIndex >= 0) {
      normalized.createdAt = this.state.targets[existingIndex].createdAt;
      this.state.targets[existingIndex] = normalized;
    } else {
      this.state.targets.push(normalized);
    }

    this.persist();
    return clone(normalized);
  }

  listTargets() {
    return clone(
      [...this.state.targets].sort((left, right) => left.label.localeCompare(right.label))
    );
  }

  upsertAuthProfile(input) {
    if (!input || typeof input !== "object") {
      throw new Error("auth_profile_upsert requires an object payload.");
    }

    const profileId = readString(input.id) || `auth-profile-${String(++this.state.counters.authProfile).padStart(4, "0")}`;
    const previous = this.hasAuthProfile(profileId) ? this.readAuthProfileFile(profileId) : null;
    const normalized = normalizeAuthProfile(input, profileId, previous);

    if (!normalized.label) {
      throw new Error("Auth profile label is required.");
    }

    if (normalized.authType === "api_key") {
      if (!normalized.apiKey) {
        throw new Error("Auth profile API key is required.");
      }
    } else if (normalized.authType === "chatgpt_session") {
      if (!normalized.authJsonPath) {
        throw new Error("ChatGPT session profile is missing authJsonPath.");
      }
    } else {
      throw new Error(`Unsupported auth profile type: ${normalized.authType}`);
    }

    this.writeAuthProfileFile(normalized);
    this.persist();
    return sanitizeAuthProfile(normalized);
  }

  importLocalCodexAuthProfile(input = {}) {
    const authJsonPath = readString(input.authJsonPath, path.join(os.homedir(), ".codex", "auth.json"));
    const capSidPath = readString(input.capSidPath, path.join(os.homedir(), ".codex", "cap_sid"));

    if (!fs.existsSync(authJsonPath)) {
      throw new Error(`Local Codex auth file not found: ${authJsonPath}`);
    }

    const authPayload = JSON.parse(fs.readFileSync(authJsonPath, "utf8"));
    const profileId = readString(input.id) || `auth-profile-${String(++this.state.counters.authProfile).padStart(4, "0")}`;
    const previous = this.hasAuthProfile(profileId) ? this.readAuthProfileFile(profileId) : null;
    const profileDir = this.profileDir(profileId);
    const bundledAuthPath = path.join(profileDir, "auth.json");
    const bundledCapSidPath = path.join(profileDir, "cap_sid");

    ensureDir(profileDir);
    fs.copyFileSync(authJsonPath, bundledAuthPath);
    if (fs.existsSync(capSidPath)) {
      fs.copyFileSync(capSidPath, bundledCapSidPath);
    }

    const normalized = normalizeAuthProfile({
      id: profileId,
      label: readString(input.label, previous?.label || "Current local Codex login"),
      authType: "chatgpt_session",
      notes: readString(input.notes, previous?.notes || "Imported from local ~/.codex login state."),
      authMode: readString(authPayload.auth_mode, ""),
      authJsonPath: bundledAuthPath,
      capSidPath: fs.existsSync(bundledCapSidPath) ? bundledCapSidPath : ""
    }, profileId, previous);

    this.writeAuthProfileFile(normalized);
    this.persist();
    return sanitizeAuthProfile(normalized);
  }

  hasAuthProfile(profileId) {
    return fs.existsSync(this.profileManifestPath(profileId));
  }

  listAuthProfiles() {
    return clone(
      this.listAuthProfileIds()
        .map((profileId) => sanitizeAuthProfile(this.readAuthProfileFile(profileId)))
        .sort((left, right) => left.label.localeCompare(right.label))
    );
  }

  getAuthProfile(profileId, options = {}) {
    const profile = this.readAuthProfileFile(profileId);
    return clone(options.includeSecret ? profile : sanitizeAuthProfile(profile));
  }

  removeAuthProfile(profileId) {
    const profilePath = this.profileDir(profileId);
    if (!fs.existsSync(profilePath)) {
      throw new Error(`Auth profile not found: ${profileId}`);
    }

    fs.rmSync(profilePath, { recursive: true, force: true });
    this.persist();
    return { removedProfileId: profileId };
  }

  getTarget(targetId) {
    const target = this.state.targets.find((item) => item.id === targetId);
    if (!target) {
      throw new Error(`Target not found: ${targetId}`);
    }

    return clone(target);
  }

  removeTarget(targetId) {
    const before = this.state.targets.length;
    this.state.targets = this.state.targets.filter((target) => target.id !== targetId);
    this.state.sessions = this.state.sessions.filter((session) => session.targetId !== targetId);

    if (this.state.targets.length === before) {
      throw new Error(`Target not found: ${targetId}`);
    }

    this.persist();
    return { removedTargetId: targetId };
  }

  upsertSession(input) {
    const key = `${input.targetId}::${input.threadId}`;
    const now = nowIso();
    const existingIndex = this.state.sessions.findIndex(
      (session) => `${session.targetId}::${session.threadId}` === key
    );
    const nextSession = {
      targetId: input.targetId,
      threadId: input.threadId,
      targetLabel: readString(input.targetLabel, ""),
      preview: readString(input.preview, ""),
      cwd: readString(input.cwd),
      model: readString(input.model),
      status: readString(input.status, "idle"),
      lastTurnId: readString(input.lastTurnId),
      lastTurnStatus: readString(input.lastTurnStatus),
      lastAssistantMessage: readString(input.lastAssistantMessage, ""),
      updatedAt: now,
      createdAt: now
    };

    if (existingIndex >= 0) {
      const previous = this.state.sessions[existingIndex];
      this.state.sessions[existingIndex] = {
        ...previous,
        ...nextSession,
        createdAt: previous.createdAt
      };
    } else {
      this.state.sessions.push(nextSession);
    }

    this.persist();
    return clone(this.state.sessions.find((session) => `${session.targetId}::${session.threadId}` === key));
  }

  listSessions(options = {}) {
    const { targetId = null, limit = 50 } = options;
    let sessions = [...this.state.sessions];

    if (targetId) {
      sessions = sessions.filter((session) => session.targetId === targetId);
    }

    sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return clone(sessions.slice(0, limit));
  }
}

module.exports = {
  ControlPlaneState
};
