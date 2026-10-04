"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const routes_1 = __importDefault(require("./routes"));
const notFound_1 = require("./core/middlewares/notFound");
const errorHandler_1 = require("./core/middlewares/errorHandler");
const app = (0, express_1.default)();
// Middleware
app.use(express_1.default.json());
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)("dev"));
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
app.use("/api/v1", routes_1.default);
/**
 * 404
 */
app.use(notFound_1.notFound);
/**
 * Error Handler
 */
app.use(errorHandler_1.errorHandler);
exports.default = app;
