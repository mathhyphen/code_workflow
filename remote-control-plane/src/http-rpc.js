const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const STATIC_MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function success(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function failure(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    error: {
      code,
      message,
      data
    }
  };
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = STATIC_MIME_TYPES[extension] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(body);
}

function createHttpRpcServer({ host, port, logger, service, staticDir }) {
  let activePort = port;

  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      const pathname = new URL(req.url, `http://${req.headers.host || `${host}:${activePort}`}`).pathname;

      if (pathname === "/health") {
        json(res, 200, service.health());
        return;
      }

      if (staticDir) {
        const relativePath = pathname === "/favicon.ico"
          ? "favicon.svg"
          : pathname === "/"
          ? "index.html"
          : pathname.replace(/^\/+/, "");
        const candidatePath = path.resolve(staticDir, relativePath);

        if (candidatePath.startsWith(path.resolve(staticDir)) && fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          sendFile(res, candidatePath);
          return;
        }
      }

      json(res, 404, { error: "Not found" });
      return;
    }

    if (req.method !== "POST" || req.url !== "/rpc") {
      json(res, 404, { error: "Not found" });
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      let payload;

      try {
        payload = JSON.parse(body || "{}");
      } catch (error) {
        json(res, 400, failure(null, -32700, "Parse error", error.message));
        return;
      }

      const { id, jsonrpc, method, params = {} } = payload;
      if (jsonrpc !== "2.0" || !method) {
        json(res, 400, failure(id, -32600, "Invalid Request"));
        return;
      }

      try {
        let result;
        switch (method) {
          case "control_health":
            result = service.health();
            break;
          case "target_list":
            result = service.listTargets();
            break;
          case "auth_profile_list":
            result = service.listAuthProfiles();
            break;
          case "auth_profile_import_local":
            result = service.importLocalAuthProfile(params);
            break;
          case "auth_profile_upsert":
            result = service.upsertAuthProfile(params);
            break;
          case "auth_profile_remove":
            result = service.removeAuthProfile(params);
            break;
          case "auth_profile_apply":
            result = await service.applyAuthProfile(params);
            break;
          case "target_upsert":
            result = service.upsertTarget(params);
            break;
          case "target_remove":
            result = await service.removeTarget(params);
            break;
          case "target_probe":
            result = await service.probeTarget(params);
            break;
          case "target_connect":
            result = await service.connectTarget(params);
            break;
          case "target_disconnect":
            result = await service.disconnectTarget(params);
            break;
          case "remote_auth_status":
            result = await service.remoteAuthStatus(params);
            break;
          case "remote_auth_logout":
            result = await service.remoteAuthLogout(params);
            break;
          case "remote_auth_start_device":
            result = service.startRemoteDeviceAuth(params);
            break;
          case "remote_auth_job_read":
            result = service.readRemoteAuthJob(params);
            break;
          case "remote_auth_job_cancel":
            result = await service.cancelRemoteAuthJob(params);
            break;
          case "session_list":
            result = service.listSessions(params);
            break;
          case "tunnel_list":
            result = service.listTunnels();
            break;
          case "thread_start":
            result = await service.startThread(params);
            break;
          case "turn_start":
            result = await service.startTurn(params);
            break;
          case "thread_read":
            result = await service.readThread(params);
            break;
          case "thread_list":
            result = await service.listThreads(params);
            break;
          default:
            json(res, 404, failure(id, -32601, `Method not found: ${method}`));
            return;
        }

        json(res, 200, success(id, result));
      } catch (error) {
        logger.error("RPC method failed.", {
          method,
          error: error.message
        });
        json(res, 500, failure(id, -32000, error.message));
      }
    });
  });

  return {
    async start() {
      await new Promise((resolve) => {
        server.listen(port, host, resolve);
      });

      const address = server.address();
      if (address && typeof address === "object") {
        activePort = address.port;
      }

      logger.info("Control plane JSON-RPC endpoint ready.", {
        host,
        port: activePort,
        route: "/rpc"
      });

      return { host, port: activePort };
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    getPort() {
      return activePort;
    }
  };
}

module.exports = {
  createHttpRpcServer
};
