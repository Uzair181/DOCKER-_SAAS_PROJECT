const net = require("net");

class RedisClient {
  constructor(urlString) {
    const url = new URL(urlString || "redis://localhost:6379");
    this.host = url.hostname;
    this.port = Number(url.port || 6379);
    this.socket = null;
    this.buffer = "";
    this.pending = [];
    this.connected = false;
  }

  async connect() {
    if (this.connected) {
      return;
    }

    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setEncoding("utf8");

    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
      this._drain();
    });

    this.socket.on("error", (error) => {
      this._failAll(error);
      this.connected = false;
    });

    this.socket.on("close", () => {
      this.connected = false;
      this._failAll(new Error("Redis connection closed"));
    });

    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });

    this.connected = true;
  }

  async get(key) {
    return this.command("GET", key);
  }

  async set(key, value) {
    return this.command("SET", key, value);
  }

  async del(key) {
    return Number(await this.command("DEL", key));
  }

  async command(...parts) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(this._encodeCommand(parts));
    });
  }

  _encodeCommand(parts) {
    const payload = [`*${parts.length}\r\n`];
    for (const part of parts) {
      const value = String(part);
      payload.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
    }
    return payload.join("");
  }

  _drain() {
    while (true) {
      const parsed = this._parseOne(this.buffer);
      if (!parsed) {
        return;
      }

      const { value, rest } = parsed;
      this.buffer = rest;
      const pending = this.pending.shift();
      if (pending) {
        if (value instanceof Error) {
          pending.reject(value);
        } else {
          pending.resolve(value);
        }
      }
    }
  }

  _failAll(error) {
    while (this.pending.length > 0) {
      const pending = this.pending.shift();
      pending.reject(error);
    }
  }

  _parseOne(input) {
    if (!input || input.length < 3) {
      return null;
    }

    const type = input[0];

    if (type === "+") {
      const end = input.indexOf("\r\n");
      if (end === -1) return null;
      return { value: input.slice(1, end), rest: input.slice(end + 2) };
    }

    if (type === ":") {
      const end = input.indexOf("\r\n");
      if (end === -1) return null;
      return { value: Number(input.slice(1, end)), rest: input.slice(end + 2) };
    }

    if (type === "-") {
      const end = input.indexOf("\r\n");
      if (end === -1) return null;
      return {
        value: new Error(input.slice(1, end)),
        rest: input.slice(end + 2),
      };
    }

    if (type === "$") {
      const headerEnd = input.indexOf("\r\n");
      if (headerEnd === -1) return null;
      const length = Number(input.slice(1, headerEnd));
      if (length === -1) {
        return { value: null, rest: input.slice(headerEnd + 2) };
      }

      const start = headerEnd + 2;
      const end = start + length;
      if (input.length < end + 2) return null;
      return { value: input.slice(start, end), rest: input.slice(end + 2) };
    }

    return null;
  }
}

module.exports = { RedisClient };
