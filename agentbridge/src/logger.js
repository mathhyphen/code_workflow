function formatMeta(meta) {
  if (meta === undefined || meta === null) {
    return "";
  }

  if (typeof meta === "string") {
    return ` ${meta}`;
  }

  return ` ${JSON.stringify(meta)}`;
}

function createLogger(scope) {
  const write = (level, message, meta) => {
    const line = `[${new Date().toISOString()}] [${scope}] [${level}] ${message}${formatMeta(meta)}\n`;
    process.stderr.write(line);
  };

  return {
    info(message, meta) {
      write("INFO", message, meta);
    },
    warn(message, meta) {
      write("WARN", message, meta);
    },
    error(message, meta) {
      write("ERROR", message, meta);
    }
  };
}

module.exports = {
  createLogger
};
