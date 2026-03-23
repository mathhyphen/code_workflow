function nowIso() {
  return new Date().toISOString();
}

function write(level, scope, message, extra) {
  const suffix = extra && Object.keys(extra).length > 0
    ? ` ${JSON.stringify(extra)}`
    : "";

  process.stdout.write(
    `[${nowIso()}] [${level.toUpperCase()}] [${scope}] ${message}${suffix}\n`
  );
}

function createLogger(scope) {
  return {
    debug(message, extra = {}) {
      write("debug", scope, message, extra);
    },
    info(message, extra = {}) {
      write("info", scope, message, extra);
    },
    warn(message, extra = {}) {
      write("warn", scope, message, extra);
    },
    error(message, extra = {}) {
      write("error", scope, message, extra);
    }
  };
}

module.exports = {
  createLogger
};
