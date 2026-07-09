import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import routes from "./routes";

import { notFound } from "./core/middlewares/notFound";
import { errorHandler } from "./core/middlewares/errorHandler";

const app = express();

// Middleware
app.use(express.json());
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
 * ReceiptWatcher APIs
 */
app.post("/receipt", (req, res) => {
  console.log(req.body);

  res.json({
    success: true,
  });
});

app.post("/api/events", (req, res) => {
  console.log(req.body);

  res.json({
    success: true,
  });
});

app.post("/api/auth/activate", (req, res) => {
  console.log(req.body);

  res.json({
    success: true,
  });
});

app.get("/api/config/sync", (_, res) => {
  res.json({
    status: "OK",
    time: new Date(),
  });
});

/**
 * Mobile APIs
 */
app.use("/api/v1", routes);

/**
 * 404
 */
app.use(notFound);

/**
 * Error Handler
 */
app.use(errorHandler);

export default app;
