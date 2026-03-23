const fs = require("node:fs");

function usage() {
  process.stderr.write("Usage: node scripts/rpc-call.js <method> [json-params|@file.json]\n");
  process.exit(1);
}

function loadParams(raw) {
  if (!raw) {
    return {};
  }

  if (raw.startsWith("@")) {
    return JSON.parse(fs.readFileSync(raw.slice(1), "utf8"));
  }

  return JSON.parse(raw);
}

async function main() {
  const method = process.argv[2];
  const rawParams = process.argv[3];

  if (!method) {
    usage();
  }

  const host = process.env.AGENTBRIDGE_HOST || "127.0.0.1";
  const port = process.env.AGENTBRIDGE_PORT || "8765";
  const url = process.env.AGENTBRIDGE_URL || `http://${host}:${port}/rpc`;
  const payload = {
    jsonrpc: "2.0",
    id: `cli-${Date.now()}`,
    method,
    params: loadParams(rawParams)
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  process.stdout.write(text);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
