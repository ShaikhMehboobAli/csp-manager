import { Router } from "express";

import { authMiddleware } from "../../../core/middlewares/auth.middleware";
import { authorize } from "../../../core/middlewares/authorize.middleware";
import { validate } from "../../../core/middlewares/validate";
import { UserRole } from "../../../generated/prisma/enums";

import * as DiagnosticsController from "./diagnostics.controller";
import { createDiagnosticsSchema, uploadDiagnosticsSchema } from "./diagnostics.validation";

/** Super admin, mounted at /admin (before the /admin catch-all guard). */
export const diagnosticsAdminRoutes = Router();

const superAdmin = [authMiddleware, authorize(UserRole.SUPER_ADMIN)];

diagnosticsAdminRoutes.post(
  "/machines/:machineId/diagnostics",
  ...superAdmin,
  validate(createDiagnosticsSchema),
  DiagnosticsController.createDiagnostics,
);
diagnosticsAdminRoutes.get("/diagnostics", ...superAdmin, DiagnosticsController.listDiagnostics);
diagnosticsAdminRoutes.get("/diagnostics/:requestId", ...superAdmin, DiagnosticsController.getDiagnostics);
diagnosticsAdminRoutes.delete("/diagnostics/:requestId", ...superAdmin, DiagnosticsController.cancelDiagnostics);
diagnosticsAdminRoutes.get(
  "/diagnostics/:requestId/parts/:part",
  ...superAdmin,
  DiagnosticsController.downloadDiagnosticsPart,
);

/** CSP / BC app: "Send PC log to support", mounted under /machines. */
export const diagnosticsOwnerRoutes = Router();

diagnosticsOwnerRoutes.post(
  "/:machineId/diagnostics",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN),
  validate(createDiagnosticsSchema),
  DiagnosticsController.createDiagnostics,
);
diagnosticsOwnerRoutes.get(
  "/:machineId/diagnostics",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN),
  DiagnosticsController.listDiagnostics,
);

/** Desktop upload, mounted under /machines/runtime. */
export const diagnosticsRuntimeRoutes = Router();

diagnosticsRuntimeRoutes.post("/diagnostics", validate(uploadDiagnosticsSchema), DiagnosticsController.uploadDiagnostics);
