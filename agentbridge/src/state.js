const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createEmptyState() {
  const now = nowIso();

  return {
    createdAt: now,
    updatedAt: now,
    counters: {
      task: 0,
      result: 0
    },
    tasks: [],
    results: []
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeTask(taskInput, id) {
  const now = nowIso();

  return {
    id,
    title: String(taskInput.title || "Untitled task").trim(),
    description: String(taskInput.description || "").trim(),
    repoPath: taskInput.repoPath ? String(taskInput.repoPath).trim() : null,
    acceptanceCriteria: normalizeStringArray(taskInput.acceptanceCriteria),
    commands: normalizeStringArray(taskInput.commands),
    labels: normalizeStringArray(taskInput.labels),
    metadata: typeof taskInput.metadata === "object" && taskInput.metadata !== null ? taskInput.metadata : {},
    priority: String(taskInput.priority || "normal"),
    status: "queued",
    claimedBy: null,
    claimedAt: null,
    completedAt: null,
    lastResultId: null,
    createdAt: now,
    updatedAt: now
  };
}

class BridgeState extends EventEmitter {
  constructor(filePath, logger) {
    super();
    this.filePath = path.resolve(filePath);
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

      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

      return {
        ...createEmptyState(),
        ...parsed,
        counters: {
          ...createEmptyState().counters,
          ...(parsed.counters || {})
        },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        results: Array.isArray(parsed.results) ? parsed.results : []
      };
    } catch (error) {
      this.logger.warn("State file was unreadable. Reinitializing empty state.", {
        filePath: this.filePath,
        error: error.message
      });
      const empty = createEmptyState();
      this.saveState(empty);
      return empty;
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

  queueStats() {
    const tasks = this.state.tasks;

    return {
      queued: tasks.filter((task) => task.status === "queued").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      failed: tasks.filter((task) => task.status === "failed").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      totalResults: this.state.results.length
    };
  }

  enqueueTask(taskInput) {
    const taskId = `task-${String(++this.state.counters.task).padStart(4, "0")}`;
    const task = normalizeTask(taskInput, taskId);

    this.state.tasks.push(task);
    this.persist();
    this.emit("task-enqueued", clone(task));
    return clone(task);
  }

  listTasks(options = {}) {
    const { status, limit = 50 } = options;
    let tasks = [...this.state.tasks];

    if (status) {
      tasks = tasks.filter((task) => task.status === status);
    }

    tasks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return clone(tasks.slice(0, limit));
  }

  listResults(options = {}) {
    const { taskId, limit = 50 } = options;
    let results = [...this.state.results];

    if (taskId) {
      results = results.filter((result) => result.taskId === taskId);
    }

    results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return clone(results.slice(0, limit));
  }

  claimNextTask(workerId) {
    const task = this.state.tasks.find((item) => item.status === "queued");

    if (!task) {
      return null;
    }

    task.status = "in_progress";
    task.claimedBy = workerId || "unknown-worker";
    task.claimedAt = nowIso();
    task.updatedAt = nowIso();
    this.persist();
    return clone(task);
  }

  async waitForNextTask(options = {}) {
    const { workerId = "claude-code", timeoutMs = 0 } = options;
    const claimed = this.claimNextTask(workerId);

    if (claimed) {
      return claimed;
    }

    if (timeoutMs <= 0) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;

      const finish = (task) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        this.off("task-enqueued", onTaskEnqueued);
        resolve(task);
      };

      const onTaskEnqueued = () => {
        const nextTask = this.claimNextTask(workerId);
        if (nextTask) {
          finish(nextTask);
        }
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      this.on("task-enqueued", onTaskEnqueued);
    });
  }

  submitResult(input) {
    const task = this.state.tasks.find((item) => item.id === input.taskId);

    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const now = nowIso();
    const resultId = `result-${String(++this.state.counters.result).padStart(4, "0")}`;
    const status = String(input.status || "success");
    const result = {
      id: resultId,
      taskId: task.id,
      workerId: String(input.workerId || task.claimedBy || "unknown-worker"),
      status,
      summary: String(input.summary || "").trim(),
      log: input.log ? String(input.log) : "",
      nextAction: input.nextAction ? String(input.nextAction) : "",
      artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
      requeue: Boolean(input.requeue),
      createdAt: now
    };

    this.state.results.push(result);

    task.lastResultId = result.id;
    task.updatedAt = now;

    if (result.requeue) {
      task.status = "queued";
      task.claimedBy = null;
      task.claimedAt = null;
      task.completedAt = null;
    } else if (status === "success") {
      task.status = "completed";
      task.completedAt = now;
    } else if (status === "blocked") {
      task.status = "blocked";
      task.completedAt = now;
    } else {
      task.status = "failed";
      task.completedAt = now;
    }

    this.persist();
    this.emit("result-submitted", clone(result));
    return clone(result);
  }
}

module.exports = {
  BridgeState
};
