const { ensureStackRunning } = require("./stack-utils.js");

async function main() {
  const result = await ensureStackRunning({ ensureWorker: true });

  process.stdout.write(`${JSON.stringify({
    bridgeUrl: result.config.bridgeUrl,
    daemonStarted: result.daemonStarted,
    workerStarted: result.workerStarted
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
