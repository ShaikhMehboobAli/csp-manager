"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const notFound_1 = require("./core/middlewares/notFound");
const errorHandler_1 = require("./core/middlewares/errorHandler");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)("dev"));
app.use(notFound_1.notFound);
app.use(errorHandler_1.errorHandler);
app.get("/", (req, res) => {
    res.send("Server is running");
});
app.post("/receipt", (req, res) => {
    console.log("Receipt Received");
    console.log(req.body);
    res.json({
        success: true,
        data: req.body,
    });
});
app.post("/api/events", (req, res) => {
    console.log("Event Request Received");
    console.log(req.body);
    res.json({
        success: true,
        data: req.body,
    });
});
app.post("/api/auth/activate", (req, res) => {
    console.log("Activate Request Received");
    console.log(req.body);
    res.json({
        success: true,
        data: req.body,
    });
});
app.get("/api/config/sync", (req, res) => {
    console.log("Health API Called");
    res.json({
        status: "OK",
        service: "CSP Manager API",
        time: new Date(),
    });
});
exports.default = app;
