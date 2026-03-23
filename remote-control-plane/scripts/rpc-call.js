const { readConfig } = require("../src/config.js");

async function main() {
  const method = process.argv[2];
  if (!method) {
    throw new Error("Usage: node scripts/rpc-call.js <method> [json-params]");
  }

  const rawParams = process.argv[3];
  const params = rawParams ? JSON.parse(rawParams) : {};
  const config = readConfig();
  const response = await fetch(config.controlUrl, {
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

  process.stdout.write(`${JSON.stringify(payload.result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
