const fs = require("node:fs");
const path = require("node:path");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeRead(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8");
}

function appendText(filePath, text) {
  fs.appendFileSync(filePath, text, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text, "utf8");
}

function getMemoryPaths(repoPath) {
  const root = path.join(repoPath, ".agentbridge");
  const reportsRoot = path.join(repoPath, "reports");
  const executionReportsDir = path.join(reportsRoot, "execution");

  return {
    root,
    reportsRoot,
    executionReportsDir,
    projectMemory: path.join(root, "project-memory.md"),
    currentTask: path.join(root, "current-task.md"),
    taskHistory: path.join(root, "task-history.md"),
    plannerInbox: path.join(root, "planner-inbox.md"),
    researchPlan: path.join(root, "research-plan.md")
  };
}

function createProjectMemoryTemplate(repoPath) {
  return [
    "# Project Memory",
    "",
    `Repository: ${repoPath}`,
    "",
    "## Purpose",
    "- What this project does.",
    "",
    "## Architecture",
    "- Key modules, entrypoints, or data flows.",
    "",
    "## Conventions",
    "- Coding, testing, or deployment conventions worth preserving.",
    "",
    "## Known Risks",
    "- Ongoing issues or fragile areas future tasks should watch.",
    "",
    "## Active Notes",
    "- Durable facts only. Avoid transient command logs here.",
    ""
  ].join("\n");
}

function createTaskHistoryTemplate() {
  return [
    "# Task History",
    "",
    "Append compact execution records here so future tasks can see what already happened.",
    ""
  ].join("\n");
}

function createPlannerInboxTemplate() {
  return [
    "# Planner Inbox",
    "",
    "Codex should read this file first after an execution run finishes.",
    "",
    "## Latest Execution",
    "- No execution report yet.",
    "",
    "## Next Planning Questions",
    "- none",
    "",
    "## Read Next",
    "- .agentbridge/project-memory.md",
    "- .agentbridge/task-history.md",
    "- reports/execution/",
    ""
  ].join("\n");
}

function createResearchPlanTemplate() {
  return [
    "# Research Plan",
    "",
    "This file is intended for Codex or the planning agent.",
    "",
    "## Goal",
    "- Define the current research goal or experiment objective.",
    "",
    "## Hypotheses",
    "- Track hypotheses to validate.",
    "",
    "## Current Strategy",
    "- Describe the planned sequence of experiments.",
    "",
    "## Open Questions",
    "- What still needs investigation?",
    "",
    "## Next Tasks For Claude",
    "- Write concrete execution tasks here before enqueueing them.",
    ""
  ].join("\n");
}

function slugify(value) {
  return String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "task";
}

function ensureProjectMemory(repoPath) {
  const paths = getMemoryPaths(repoPath);
  ensureDir(paths.root);
  ensureDir(paths.reportsRoot);
  ensureDir(paths.executionReportsDir);

  if (!fs.existsSync(paths.projectMemory)) {
    writeText(paths.projectMemory, createProjectMemoryTemplate(repoPath));
  }

  if (!fs.existsSync(paths.taskHistory)) {
    writeText(paths.taskHistory, createTaskHistoryTemplate());
  }

  if (!fs.existsSync(paths.currentTask)) {
    writeText(paths.currentTask, "# Current Task\n\nNo active task.\n");
  }

  if (!fs.existsSync(paths.plannerInbox)) {
    writeText(paths.plannerInbox, createPlannerInboxTemplate());
  }

  if (!fs.existsSync(paths.researchPlan)) {
    writeText(paths.researchPlan, createResearchPlanTemplate());
  }

  return paths;
}

function formatList(items) {
  if (!items || !items.length) {
    return "- none";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function writeCurrentTask(paths, task) {
  const content = [
    "# Current Task",
    "",
    `Updated: ${nowIso()}`,
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Priority: ${task.priority}`,
    `Repo Path: ${task.repoPath || "not provided"}`,
    "",
    "## Description",
    task.description || "No description provided.",
    "",
    "## Acceptance Criteria",
    formatList(task.acceptanceCriteria),
    "",
    "## Suggested Commands",
    formatList(task.commands),
    "",
    "## Labels",
    formatList(task.labels),
    "",
    "## Metadata",
    "```json",
    JSON.stringify(task.metadata || {}, null, 2),
    "```",
    "",
    "## Notes For Claude",
    "- Read project-memory.md before making durable decisions.",
    "- Update project-memory.md only with reusable facts.",
    "- Record task-specific findings below before finishing.",
    "",
    "## Execution Notes",
    "- pending",
    ""
  ].join("\n");

  writeText(paths.currentTask, content);
}

function finalizeCurrentTask(paths, task, report) {
  const content = [
    "# Current Task",
    "",
    `Updated: ${nowIso()}`,
    "",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Final Status: ${report.status}`,
    "",
    "## Summary",
    report.summary || "No summary provided.",
    "",
    "## Next Action",
    report.nextAction || "none",
    "",
    "## Artifacts",
    report.artifacts && report.artifacts.length
      ? report.artifacts.map((artifact) => `- ${artifact.path}${artifact.note ? ` | ${artifact.note}` : ""}`).join("\n")
      : "- none",
    "",
    "## Planner Handoff",
    "- Read .agentbridge/planner-inbox.md for the latest execution summary and next planning questions.",
    "",
    "## Log Snippet",
    "```text",
    report.log || "",
    "```",
    ""
  ].join("\n");

  writeText(paths.currentTask, content);
}

function appendTaskHistory(paths, task, report) {
  const entry = [
    `## ${task.id} - ${task.title}`,
    "",
    `- Time: ${nowIso()}`,
    `- Status: ${report.status}`,
    `- Summary: ${report.summary || "none"}`,
    `- Next action: ${report.nextAction || "none"}`,
    report.executionReportPath ? `- Execution report: ${report.executionReportPath}` : "",
    report.artifacts && report.artifacts.length
      ? `- Result artifacts: ${report.artifacts.map((artifact) => artifact.path).join(", ")}`
      : "- Result artifacts: none",
    report.log ? "- Log excerpt:" : "",
    report.log ? "```text" : "",
    report.log ? report.log.slice(0, 2000) : "",
    report.log ? "```" : "",
    "",
    ""
  ].filter(Boolean).join("\n");

  appendText(paths.taskHistory, entry);
}

function writeExecutionReport(paths, task, report) {
  const timestamp = nowIso().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-${task.id}-${slugify(task.title)}.md`;
  const reportPath = path.join(paths.executionReportsDir, fileName);
  const repoRoot = path.dirname(paths.root);
  const relativeReportPath = path.relative(repoRoot, reportPath)
    .split(path.sep)
    .join("/");
  const content = [
    "# Execution Report",
    "",
    `- Time: ${nowIso()}`,
    `- Task ID: ${task.id}`,
    `- Title: ${task.title}`,
    `- Status: ${report.status}`,
    `- Repo Path: ${task.repoPath || "not provided"}`,
    "",
    "## Task Description",
    task.description || "No description provided.",
    "",
    "## Acceptance Criteria",
    formatList(task.acceptanceCriteria),
    "",
    "## Suggested Commands",
    formatList(task.commands),
    "",
    "## Summary",
    report.summary || "No summary provided.",
    "",
    "## Next Action",
    report.nextAction || "none",
    "",
    "## Artifacts",
    report.artifacts && report.artifacts.length
      ? report.artifacts.map((artifact) => `- ${artifact.path}${artifact.note ? ` | ${artifact.note}` : ""}`).join("\n")
      : "- none",
    "",
    "## Log Snippet",
    "```text",
    report.log || "",
    "```",
    "",
    "## Planner Read Next",
    "- .agentbridge/project-memory.md",
    "- .agentbridge/task-history.md",
    "- .agentbridge/research-plan.md",
    ""
  ].join("\n");

  writeText(reportPath, content);
  return relativeReportPath;
}

function updatePlannerInbox(paths, task, report) {
  const content = [
    "# Planner Inbox",
    "",
    `Updated: ${nowIso()}`,
    "",
    "## Latest Execution",
    `- Task ID: ${task.id}`,
    `- Title: ${task.title}`,
    `- Status: ${report.status}`,
    `- Summary: ${report.summary || "none"}`,
    `- Next action from executor: ${report.nextAction || "none"}`,
    report.executionReportPath ? `- Execution report: ${report.executionReportPath}` : "- Execution report: none",
    "",
    "## Next Planning Questions",
    report.nextAction && report.nextAction !== "none"
      ? `- Should the next task address: ${report.nextAction}?`
      : "- What is the best next experiment or refactor step based on the latest execution report?",
    "",
    "## Read Next",
    "- .agentbridge/project-memory.md",
    "- .agentbridge/task-history.md",
    "- .agentbridge/research-plan.md",
    "- reports/execution/",
    ""
  ].join("\n");

  writeText(paths.plannerInbox, content);
}

function collectMemoryContext(paths) {
  return {
    projectMemory: safeRead(paths.projectMemory),
    currentTask: safeRead(paths.currentTask),
    taskHistory: safeRead(paths.taskHistory),
    plannerInbox: safeRead(paths.plannerInbox),
    researchPlan: safeRead(paths.researchPlan)
  };
}

module.exports = {
  ensureProjectMemory,
  getMemoryPaths,
  writeCurrentTask,
  finalizeCurrentTask,
  appendTaskHistory,
  writeExecutionReport,
  updatePlannerInbox,
  collectMemoryContext
};
