import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as CommissionController from "./commission.controller";

/** App: the CSP's commission (CSP, BC, super admin). Mounted at /commission. */
export const commissionRoutes = Router();

commissionRoutes.use(authMiddleware);

const viewers = authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN, UserRole.SUPER_ADMIN);

commissionRoutes.get("/summary", viewers, CommissionController.getSummary);
commissionRoutes.get("/months", viewers, CommissionController.getMonths);
commissionRoutes.get("/rates", viewers, CommissionController.getRates);

/** Super admin: services and rates. Mounted at /admin/commission. */
export const commissionAdminRoutes = Router();

commissionAdminRoutes.use(authMiddleware, authorize(UserRole.SUPER_ADMIN));

commissionAdminRoutes.get("/services", CommissionController.adminListServices);
commissionAdminRoutes.patch("/services/:code", CommissionController.adminUpdateService);
commissionAdminRoutes.get("/rates", CommissionController.adminListRates);
commissionAdminRoutes.get("/rates/history", CommissionController.adminRateHistory);
commissionAdminRoutes.post("/rates", CommissionController.adminSetRate);
commissionAdminRoutes.delete("/rates/:rateId", CommissionController.adminDeleteRate);
