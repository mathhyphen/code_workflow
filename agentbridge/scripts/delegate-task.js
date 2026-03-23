const fs = require("node:fs");
const { ensureStackRunning } = require("./stack-utils.js");

function usage() {
  process.stderr.write("Usage: node scripts/delegate-task.js <json-params|@file.json>\n");
  process.exit(1);
}

function loadTask(raw) {
  if (!raw) {
    usage();
  }

  if (raw.startsWith("@")) {
    return JSON.parse(fs.readFileSync(raw.slice(1), "utf8"));
  }

  return JSON.parse(raw);
}

async function main() {
  const task = loadTask(process.argv[2]);
  const stack = await ensureStackRunning({ ensureWorker: true });
  const result = await stack.client.call("enqueue_task", task);

  process.stdout.write(`${JSON.stringify({
    bridgeUrl: stack.config.bridgeUrl,
    daemonStarted: stack.daemonStarted,
    workerStarted: stack.workerStarted,
    task: result.task,
    queue: result.queue
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
