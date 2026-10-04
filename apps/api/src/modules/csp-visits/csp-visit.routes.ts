import { Router } from "express";
import CspVisitController from "./csp-visit.controller";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
// import authMiddleware from "../../core/middlewares/auth.middleware";

const router = Router();
console.log("CSP VISIT ROUTER LOADED");
const controller = new CspVisitController();

router.post("/", authMiddleware, controller.createVisit.bind(controller));

router.get(
  "/csp/:cspAgentId",
  authMiddleware,
  controller.getCspVisits.bind(controller),
);

router.get("/:id", authMiddleware, controller.getVisit.bind(controller));

export default router;
