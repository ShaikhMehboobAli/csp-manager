const path = require("path");
const fs = require("fs");

const apiDir = __dirname;
const rootDir = path.resolve(__dirname, "..", "..");

const logsDir = path.resolve(apiDir, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = {};
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      parsed[key] = val;
    }
    return parsed;
  } catch {
    return {};
  }
}

const rootEnv = parseEnvFile(path.resolve(rootDir, ".env"));
const apiEnv = parseEnvFile(path.resolve(apiDir, ".env"));
const combinedEnv = { ...rootEnv, ...apiEnv };

const port = combinedEnv.PORT || process.env.PORT || "3000";

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
      max_memory_restart: "500M",
      restart_delay: 4000,
      min_uptime: "10s",
      max_restarts: 10,
      env: {
        NODE_ENV: combinedEnv.NODE_ENV || "production",
        PORT: port,
        ...combinedEnv,
      },
      env_production: {
        NODE_ENV: combinedEnv.NODE_ENV || "production",
        PORT: port,
        ...combinedEnv,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: port,
        ...combinedEnv,
      },
      error_file: path.resolve(logsDir, "error.log"),
      out_file: path.resolve(logsDir, "out.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
