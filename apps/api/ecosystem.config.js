const path = require("path");
const fs = require("fs");

const apiDir = __dirname;
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
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      restart_delay: 4000,
      min_uptime: "10s",
      max_restarts: 10,
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
      error_file: path.resolve(logsDir, "error.log"),
      out_file: path.resolve(logsDir, "out.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
