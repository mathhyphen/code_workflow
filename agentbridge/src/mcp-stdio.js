const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const { readConfig } = require("./config.js");
const { BridgeClient } = require("./bridge-client.js");
const { createLogger } = require("./logger.js");

function formatTask(task) {
  const lines = [
    `Task ${task.id}: ${task.title}`,
    task.description || "",
    task.repoPath ? `Repo path: ${task.repoPath}` : "",
    task.acceptanceCriteria.length
      ? `Acceptance criteria:\n${task.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
      : "",
    task.commands.length
      ? `Suggested commands:\n${task.commands.map((item) => `- ${item}`).join("\n")}`
      : "",
    task.labels.length ? `Labels: ${task.labels.join(", ")}` : "",
    `Priority: ${task.priority}`
  ];

  return lines.filter(Boolean).join("\n");
}

async function startMcpAdapter() {
  const config = readConfig();
  const client = new BridgeClient(config.bridgeUrl);
  const logger = createLogger("agentbridge-mcp");
  const server = new McpServer({
    name: "agentbridge-mcp-adapter",
    version: "0.2.0"
  });

  server.registerTool(
    "get_next_task_from_codex",
    {
      description: "Claim the next queued Codex task from AgentBridge.",
      inputSchema: {
        workerId: z.string().optional().describe("Worker identifier, for example claude-code."),
        maxWaitSeconds: z.number().int().min(0).max(300).optional().describe("How long to wait for a task before returning null.")
      }
    },
    async ({ workerId = "claude-code", maxWaitSeconds }) => {
      const result = await client.call("claim_task", {
        workerId,
        waitSeconds: maxWaitSeconds ?? config.defaultWaitSeconds
      });
      const task = result.task;

      if (!task) {
        return {
          content: [
            {
              type: "text",
              text: `No queued task arrived within ${maxWaitSeconds ?? config.defaultWaitSeconds} seconds.`
            }
          ],
          structuredContent: {
            task: null,
            queue: result.queue
          }
        };
      }

      return {
        content: [
          {
            type: "text",
            text: formatTask(task)
          }
        ],
        structuredContent: {
          task,
          queue: result.queue
        }
      };
    }
  );

  server.registerTool(
    "submit_result_to_codex",
    {
      description: "Submit Claude Code execution output back to Codex through AgentBridge.",
      inputSchema: {
        taskId: z.string(),
        workerId: z.string().optional(),
        status: z.enum(["success", "failed", "blocked"]),
        summary: z.string(),
        log: z.string().optional(),
        nextAction: z.string().optional(),
        requeue: z.boolean().optional(),
        artifacts: z.array(
          z.object({
            label: z.string(),
            path: z.string(),
            note: z.string().optional()
          })
        ).optional()
      }
    },
    async (input) => {
      const result = await client.call("submit_result", input);
      return {
        content: [
          {
            type: "text",
            text: `Stored ${result.result.status} result for ${result.result.taskId}.`
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "inspect_codex_queue",
    {
      description: "Inspect queued tasks and recent results in AgentBridge.",
      inputSchema: {
        taskStatus: z.enum(["queued", "in_progress", "completed", "failed", "blocked"]).optional(),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ taskStatus, limit = 10 }) => {
      const snapshot = await client.call("queue_snapshot", { taskStatus, limit });
      const taskLines = snapshot.tasks.map((task) => `- ${task.id} [${task.status}] ${task.title}`);
      const resultLines = snapshot.results.map((result) => `- ${result.id} [${result.status}] ${result.taskId}`);

      return {
        content: [
          {
            type: "text",
            text: [
              `Queue stats: ${JSON.stringify(snapshot.queue)}`,
              "Tasks:",
              taskLines.length ? taskLines.join("\n") : "- none",
              "Results:",
              resultLines.length ? resultLines.join("\n") : "- none"
            ].join("\n")
          }
        ],
        structuredContent: snapshot
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP stdio adapter ready.", { bridgeUrl: config.bridgeUrl });
}

if (require.main === module) {
  startMcpAdapter().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  startMcpAdapter
};
