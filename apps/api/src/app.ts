import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import routes from "./routes";

import { notFound } from "./core/middlewares/notFound";
import { errorHandler } from "./core/middlewares/errorHandler";
import { apiRateLimit } from "./core/middlewares/rate-limit.middleware";
import { env } from "./config/env";

const app = express();

// Behind a load balancer / reverse proxy, set TRUST_PROXY to the number of
// proxy hops so req.ip (used by the rate limits) is the client's address.
if (env.trustProxy) {
  app.set("trust proxy", env.trustProxy);
}

// Middleware
// Desktop log upload: parts up to 2 MB (gzip allowed, Content-Encoding: gzip).
app.use(
  "/api/v1/machines/runtime/diagnostics",
  express.json({
    limit: "2200kb",
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  }),
);
app.use(
  express.json({
    limit: "100kb",
    // Signed desktop requests hash the exact bytes that were sent.
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  }),
);
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

/**
 * Health Check
 */
app.get("/", (_, res) => {
  res.send("CSP Manager API Running 🚀");
});

/**
 * Mobile APIs
 */
app.use("/api/v1", apiRateLimit, routes);

/**
 * 404
 */
app.use(notFound);

/**
 * Error Handler
 */
app.use(errorHandler);

export default app;
