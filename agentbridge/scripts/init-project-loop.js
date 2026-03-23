const path = require("node:path");
const { ensureProjectMemory } = require("../src/project-memory.js");

function usage() {
  process.stderr.write("Usage: node scripts/init-project-loop.js <repo-path>\n");
  process.exit(1);
}

function main() {
  const repoPathArg = process.argv[2];

  if (!repoPathArg) {
    usage();
  }

  const repoPath = path.resolve(repoPathArg);
  const paths = ensureProjectMemory(repoPath);

  process.stdout.write(`${JSON.stringify({
    repoPath,
    created: {
      projectMemory: paths.projectMemory,
      currentTask: paths.currentTask,
      taskHistory: paths.taskHistory,
      plannerInbox: paths.plannerInbox,
      researchPlan: paths.researchPlan,
      executionReportsDir: paths.executionReportsDir
    }
  }, null, 2)}\n`);
}

main();
