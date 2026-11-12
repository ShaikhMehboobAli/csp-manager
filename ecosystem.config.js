const path = require("path");
const fs = require("fs");

// Detect whether PM2 is invoked from repository root or apps/api
const apiDir = __dirname.endsWith(path.join("apps", "api"))
  ? __dirname
  : path.resolve(__dirname, "apps", "api");

// Ensure the logs directory exists to prevent PM2 logging errors
const logsDir = path.resolve(apiDir, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = {
  apps: [
    {
      name: "csp-manager-api",
      cwd: apiDir,
      script: path.resolve(apiDir, "dist", "server.js"),

      // IMPORTANT:
      // The API runs 11 in-process scheduled background jobs (subscription renewal,
      // receipt retention, session timeout, email log cleanup, etc.) and in-memory
      // rate-limiting / device replay-nonce caches.
      // Therefore, run in 'fork' mode with 1 instance.
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 4000,
      min_uptime: "10s",
      max_restarts: 10,

      // Environment variables
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3000,
      },

      // Logging configuration
      error_file: path.resolve(logsDir, "error.log"),
      out_file: path.resolve(logsDir, "out.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
