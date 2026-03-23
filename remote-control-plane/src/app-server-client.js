class AppServerClient {
  constructor({ url, logger, clientInfo, connectTimeoutMs = 10000, requestTimeoutMs = 60000 }) {
    this.url = url;
    this.logger = logger;
    this.clientInfo = clientInfo;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.socket = null;
    this.pending = new Map();
    this.notificationHandlers = new Set();
    this.nextRequestId = 1;
    this.closed = false;
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        try {
          socket.close();
        } catch {}
        reject(new Error(`Timed out connecting to ${this.url}`));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
      };

      socket.addEventListener("open", () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.socket = socket;
        this.attachSocketHandlers(socket);
        resolve();
      });

      socket.addEventListener("error", () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(new Error(`Failed to connect to ${this.url}`));
      });
    });
  }

  attachSocketHandlers(socket) {
    socket.addEventListener("message", (event) => {
      this.onMessage(event.data.toString());
    });

    socket.addEventListener("close", () => {
      this.closed = true;
      const pending = [...this.pending.values()];
      this.pending.clear();
      pending.forEach(({ reject, timer }) => {
        clearTimeout(timer);
        reject(new Error(`Connection closed for ${this.url}`));
      });
    });

    socket.addEventListener("error", () => {
      if (!this.closed) {
        this.logger.warn("WebSocket error reported by App Server.", { url: this.url });
      }
    });
  }

  onMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      this.logger.warn("Ignoring non-JSON message from App Server.", {
        url: this.url,
        error: error.message
      });
      return;
    }

    if (payload.method) {
      for (const handler of this.notificationHandlers) {
        handler(payload);
      }
      return;
    }

    if (!this.pending.has(payload.id)) {
      return;
    }

    const { resolve, reject, timer } = this.pending.get(payload.id);
    clearTimeout(timer);
    this.pending.delete(payload.id);

    if (payload.error) {
      reject(new Error(payload.error.message || `App Server request failed: ${payload.id}`));
      return;
    }

    resolve(payload.result);
  }

  onNotification(handler) {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  async request(method, params = {}, options = {}) {
    await this.connect();

    const id = this.nextRequestId++;
    const timeoutMs = options.timeoutMs || this.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.socket.send(JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      }));
    });
  }

  async waitForTurnCompletion({ threadId, turnId, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for turn completion: ${turnId}`));
      }, timeoutMs);

      const unsubscribe = this.onNotification((message) => {
        if (message.method === "turn/completed") {
          const params = message.params || {};
          if (params.threadId === threadId && params.turn?.id === turnId) {
            clearTimeout(timer);
            unsubscribe();
            resolve(params.turn);
          }
        }

        if (message.method === "thread/realtime/error") {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(`Realtime thread error for ${threadId}`));
        }
      });
    });
  }

  async close() {
    this.closed = true;
    if (!this.socket) {
      return;
    }

    if (this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING) {
      return;
    }

    await new Promise((resolve) => {
      const socket = this.socket;
      socket.addEventListener("close", () => resolve(), { once: true });
      socket.close();
    });
  }
}

module.exports = {
  AppServerClient
};
