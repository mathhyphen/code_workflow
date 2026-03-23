const http = require("node:http");

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

function createHttpRpcServer({ host, port, state, logger, workerManager, config }) {
  let activePort = port;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, {
          status: "ok",
          port: activePort,
          queue: state.queueStats(),
          stateFile: state.filePath
        });
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
          switch (method) {
            case "bridge_health":
              json(res, 200, success(id, {
                status: "ok",
                host,
                port: activePort,
                queue: state.queueStats(),
                stateFile: state.filePath
              }));
              return;
            case "enqueue_task": {
              const task = state.enqueueTask(params);
              if (config?.worker?.autoStart && workerManager && !workerManager.status().running) {
                workerManager.start().catch((error) => {
                  logger.error("Failed to auto-start Claude worker.", { error: error.message });
                });
              }
              json(res, 200, success(id, {
                task,
                queue: state.queueStats()
              }));
              return;
            }
            case "list_tasks":
              json(res, 200, success(id, {
                tasks: state.listTasks(params),
                queue: state.queueStats()
              }));
              return;
            case "peek_next_task": {
              const task = state.listTasks({ status: "queued", limit: 1 })[0] || null;
              json(res, 200, success(id, { task, queue: state.queueStats() }));
              return;
            }
            case "claim_task":
              json(res, 200, success(id, {
                task: await state.waitForNextTask({
                  workerId: params.workerId || "http-client",
                  timeoutMs: ((params.waitSeconds || 0) * 1000)
                }),
                queue: state.queueStats()
              }));
              return;
            case "submit_result":
              json(res, 200, success(id, {
                result: state.submitResult(params),
                queue: state.queueStats()
              }));
              return;
            case "list_results":
              json(res, 200, success(id, {
                results: state.listResults(params),
                queue: state.queueStats()
              }));
              return;
            case "queue_snapshot":
              json(res, 200, success(id, {
                queue: state.queueStats(),
                tasks: state.listTasks({
                  status: params.taskStatus,
                  limit: params.limit || 10
                }),
                results: state.listResults({
                  taskId: params.taskId,
                  limit: params.limit || 10
                }),
                worker: workerManager ? workerManager.status() : null
              }));
              return;
            case "worker_status":
              json(res, 200, success(id, {
                worker: workerManager ? workerManager.status() : null,
                queue: state.queueStats()
              }));
              return;
            case "worker_start":
              if (!workerManager) {
                json(res, 500, failure(id, -32002, "Worker manager unavailable"));
                return;
              }
              json(res, 200, success(id, {
                worker: await workerManager.start(),
                queue: state.queueStats()
              }));
              return;
            case "worker_stop":
              if (!workerManager) {
                json(res, 500, failure(id, -32002, "Worker manager unavailable"));
                return;
              }
              json(res, 200, success(id, {
                worker: await workerManager.stop(),
                queue: state.queueStats()
              }));
              return;
            default:
              json(res, 404, failure(id, -32601, `Method not found: ${method}`));
          }
        } catch (error) {
          json(res, 500, failure(id, -32000, error.message));
        }
      });
    } catch (error) {
      logger.error("Unexpected HTTP server error.", { error: error.message });
      json(res, 500, failure(null, -32001, "Internal server error", error.message));
    }
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

      logger.info("HTTP JSON-RPC endpoint ready.", {
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
