const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  ensureProjectMemory,
  writeCurrentTask,
  finalizeCurrentTask,
  appendTaskHistory,
  writeExecutionReport,
  updatePlannerInbox
} = require("./project-memory.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function windowsCommandCandidates(commandPath) {
  if (path.extname(commandPath)) {
    return [commandPath];
  }

  return [
    `${commandPath}.cmd`,
    `${commandPath}.exe`,
    commandPath
  ];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item)).filter(Boolean);
}

function resolveSkillFiles(repoPath, metadata) {
  const skillFiles = normalizeStringArray(metadata && metadata.skillFiles);

  return skillFiles
    .map((filePath) => {
      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(repoPath, filePath);

      return {
        original: filePath,
        resolved,
        exists: fs.existsSync(resolved)
      };
    });
}

function buildPrompt(task, memoryPaths, skillFiles) {
  const existingSkillFiles = skillFiles.filter((item) => item.exists);
  const missingSkillFiles = skillFiles.filter((item) => !item.exists);
  const inlineSkillPrompt = task.metadata && task.metadata.skillPrompt
    ? String(task.metadata.skillPrompt).trim()
    : "";

  return [
    "You are an autonomous Claude Code execution worker launched by AgentBridge.",
    "Do not ask the user follow-up questions. Make reasonable assumptions and complete the task as far as possible.",
    "Use your coding tools to inspect files, edit code, and run the most relevant verification commands.",
    "Work inside the current working directory unless the task explicitly requires a child path.",
    "Before changing code, read the project memory files listed below.",
    "Keep durable project knowledge in project-memory.md, not in ephemeral chat context.",
    "Before finishing, update the memory files so the next task can start from the repository state instead of old conversation context.",
    "",
    "Project memory files:",
    `- ${memoryPaths.projectMemory}`,
    `- ${memoryPaths.currentTask}`,
    `- ${memoryPaths.taskHistory}`,
    `- ${memoryPaths.plannerInbox}`,
    `- ${memoryPaths.researchPlan}`,
    "",
    "Memory workflow:",
    "- Read project-memory.md and current-task.md first.",
    "- Read planner-inbox.md to understand the latest execution outcome and what the planner should think about next.",
    "- Skim the most recent relevant entries in task-history.md if needed.",
    existingSkillFiles.length ? "- Read the required user skill files listed below and follow them unless they directly conflict with safety constraints or explicit task acceptance criteria." : "- Do the task and run relevant checks.",
    existingSkillFiles.length ? "- Do the task and run relevant checks." : "- Update project-memory.md only with durable facts, conventions, architecture notes, or real risks future tasks should know.",
    existingSkillFiles.length ? "- Update project-memory.md only with durable facts, conventions, architecture notes, or real risks future tasks should know." : "- Update current-task.md with what changed, what was verified, and any next action.",
    existingSkillFiles.length ? "- Update current-task.md with what changed, what was verified, and any next action." : "- You may append a concise handoff note to task-history.md if useful.",
    existingSkillFiles.length ? "- You may append a concise handoff note to task-history.md if useful." : "",
    "Do not rewrite research-plan.md unless the task explicitly asks you to do planning work; that file is primarily for Codex.",
    "",
    existingSkillFiles.length ? "Required user skill files:" : "",
    existingSkillFiles.length ? existingSkillFiles.map((item) => `- ${item.resolved}`).join("\n") : "",
    "",
    missingSkillFiles.length ? "Referenced skill files that were missing:" : "",
    missingSkillFiles.length ? missingSkillFiles.map((item) => `- ${item.original}`).join("\n") : "",
    "",
    inlineSkillPrompt ? "Inline skill guidance:" : "",
    inlineSkillPrompt || "",
    "",
    "Task payload:",
    JSON.stringify({
      id: task.id,
      title: task.title,
      description: task.description,
      repoPath: task.repoPath,
      acceptanceCriteria: task.acceptanceCriteria,
      commands: task.commands,
      labels: task.labels,
      metadata: task.metadata,
      priority: task.priority
    }, null, 2),
    "",
    "When you are done, output only this final report format and nothing else:",
    "STATUS: success|failed|blocked",
    "SUMMARY: one sentence",
    "NEXT_ACTION: one sentence or none",
    "ARTIFACTS:",
    "- path | note",
    "LOG_SNIPPET:",
    "relevant commands run, checks, or blocking error summary"
  ].join("\n");
}

function parseArtifacts(section) {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.slice(1).trim())
    .map((line) => {
      const [first, ...rest] = line.split("|");
      return {
        label: first.trim() || "artifact",
        path: first.trim(),
        note: rest.join("|").trim() || ""
      };
    })
    .filter((item) => item.path);
}

function parseClaudeReport(stdout, exitCode) {
  const text = String(stdout || "").trim();
  const statusMatch = text.match(/^STATUS:\s*(success|failed|blocked)\s*$/im);
  const summaryMatch = text.match(/^SUMMARY:\s*(.+)\s*$/im);
  const nextActionMatch = text.match(/^NEXT_ACTION:\s*(.+)\s*$/im);
  const artifactsMatch = text.match(/ARTIFACTS:\s*([\s\S]*?)\nLOG_SNIPPET:/im);
  const logMatch = text.match(/LOG_SNIPPET:\s*([\s\S]*)$/im);

  return {
    status: statusMatch ? statusMatch[1].toLowerCase() : (exitCode === 0 ? "success" : "failed"),
    summary: summaryMatch ? summaryMatch[1].trim() : (text.split(/\r?\n/)[0] || `Claude exited with code ${exitCode}`),
    nextAction: nextActionMatch ? nextActionMatch[1].trim() : "",
    artifacts: artifactsMatch ? parseArtifacts(artifactsMatch[1]) : [],
    log: logMatch ? logMatch[1].trim() : text
  };
}

class ClaudeWorkerManager {
  constructor({ state, logger, config }) {
    this.state = state;
    this.logger = logger;
    this.config = config;
    this.running = false;
    this.stopRequested = false;
    this.activeChild = null;
    this.activeTaskId = null;
    this.loopPromise = null;
    this.lastRunAt = null;
    this.lastExitCode = null;
    this.cachedClaudeExecutable = null;
  }

  status() {
    return {
      running: this.running,
      stopRequested: this.stopRequested,
      activeTaskId: this.activeTaskId,
      pid: this.activeChild ? this.activeChild.pid : null,
      lastRunAt: this.lastRunAt,
      lastExitCode: this.lastExitCode
    };
  }

  async start() {
    if (this.running) {
      return this.status();
    }

    this.running = true;
    this.stopRequested = false;
    this.loopPromise = this.loop();
    this.logger.info("Claude worker supervisor started.");
    return this.status();
  }

  async stop() {
    this.stopRequested = true;
    this.running = false;
    this.logger.info("Claude worker supervisor stop requested.");
    return this.status();
  }

  async close() {
    await this.stop();
    if (this.loopPromise) {
      await this.loopPromise;
    }
  }

  async loop() {
    while (!this.stopRequested) {
      const task = this.state.claimNextTask(this.config.worker.workerId);

      if (!task) {
        await sleep(this.config.worker.idlePollSeconds * 1000);
        continue;
      }

      this.activeTaskId = task.id;
      this.lastRunAt = new Date().toISOString();

      try {
        const report = await this.runClaudeTask(task);
        this.state.submitResult({
          taskId: task.id,
          workerId: this.config.worker.workerId,
          status: report.status,
          summary: report.summary,
          log: report.log,
          nextAction: report.nextAction,
          artifacts: report.artifacts
        });
      } catch (error) {
        this.state.submitResult({
          taskId: task.id,
          workerId: this.config.worker.workerId,
          status: "failed",
          summary: `Worker crashed while processing ${task.id}.`,
          log: error.stack || error.message,
          nextAction: "Inspect the worker logs and rerun the task if needed."
        });
      } finally {
        this.activeTaskId = null;
      }
    }
  }

  async runClaudeTask(task) {
    const repoPath = task.repoPath && fs.existsSync(task.repoPath)
      ? path.resolve(task.repoPath)
      : this.config.projectRoot;

    const memoryPaths = ensureProjectMemory(repoPath);
    const skillFiles = resolveSkillFiles(repoPath, task.metadata || {});
    writeCurrentTask(memoryPaths, task);
    const prompt = buildPrompt(task, memoryPaths, skillFiles);
    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--permission-mode",
      this.config.worker.permissionMode,
      "--add-dir",
      repoPath
    ];

    if (this.config.worker.model) {
      args.splice(1, 0, "--model", this.config.worker.model);
    }

    if (this.config.worker.extraArgs.length) {
      args.splice(args.length - 1, 0, ...this.config.worker.extraArgs);
    }

    this.logger.info("Launching Claude worker run.", {
      taskId: task.id,
      repoPath,
      claudeBin: this.getClaudeExecutable()
    });

    return new Promise((resolve, reject) => {
      const executable = this.getClaudeExecutable();
      const extension = path.extname(executable).toLowerCase();
      const child = spawn(executable, args, {
        cwd: repoPath,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32" && [".cmd", ".bat", ".ps1"].includes(extension),
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      this.activeChild = child;

      const timeout = setTimeout(() => {
        stderr += `\nTimed out after ${this.config.worker.timeoutSeconds} seconds.`;
        child.kill("SIGTERM");
      }, this.config.worker.timeoutSeconds * 1000);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        this.activeChild = null;
        reject(error);
      });

      child.on("exit", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        this.activeChild = null;
        this.lastExitCode = code;
        const report = parseClaudeReport(stdout, code ?? 1);

        if (stderr.trim()) {
          report.log = `${report.log}\n\n[stderr]\n${stderr.trim()}`.trim();
        }

        report.executionReportPath = writeExecutionReport(memoryPaths, task, report);
        report.artifacts = [
          ...report.artifacts,
          {
            label: "execution-report",
            path: report.executionReportPath,
            note: "standard execution report for Codex"
          }
        ];
        updatePlannerInbox(memoryPaths, task, report);
        finalizeCurrentTask(memoryPaths, task, report);
        appendTaskHistory(memoryPaths, task, report);
        resolve(report);
      });
    });
  }

  getClaudeExecutable() {
    if (this.cachedClaudeExecutable) {
      return this.cachedClaudeExecutable;
    }

    const configured = this.config.worker.claudeBin;
    if (path.isAbsolute(configured) && fs.existsSync(configured)) {
      this.cachedClaudeExecutable = configured;
      return configured;
    }

    const locator = process.platform === "win32" ? "where.exe" : "which";
    const located = spawnSync(locator, [configured], { encoding: "utf8" });

    if (located.status === 0) {
      const matches = String(located.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (matches.length) {
        if (process.platform === "win32") {
          for (const match of matches) {
            for (const candidate of windowsCommandCandidates(match)) {
              if (fs.existsSync(candidate)) {
                this.cachedClaudeExecutable = candidate;
                return candidate;
              }
            }
          }
        }

        this.cachedClaudeExecutable = matches[0];
        return matches[0];
      }
    }

    this.cachedClaudeExecutable = configured;
    return configured;
  }
}

module.exports = {
  ClaudeWorkerManager
};
