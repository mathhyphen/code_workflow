class BridgeClient {
  constructor(url) {
    this.url = url;
  }

  async call(method, params = {}) {
    const response = await fetch(this.url, {
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
      throw new Error(payload.error.message || `Bridge RPC failed for ${method}`);
    }

    return payload.result;
  }
}

module.exports = {
  BridgeClient
};
