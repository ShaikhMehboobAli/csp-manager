import { PrismaDb } from "../../../core/database/prisma.types";
import { AppError } from "../../../core/errors/AppError";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import { CurrentUser } from "../../../core/types/auth.types";
import { addDays, istDateKey } from "../../../core/utils/ist";
import { Prisma } from "../../../generated/prisma/client";
import { DiagnosticsStatus, UserRole } from "../../../generated/prisma/enums";
import AgentScopeService from "../../agents/service/agent-scope.service";
import { buildPagination } from "../../receipts/receipt.helper";

export const DIAGNOSTICS_KEEP_DAYS = 14;
/** Only the last 3 days (today and the 2 before it) can be asked for (owner decision). */
export const MAX_LOG_DAYS = 3;
export const MAX_PART_BYTES = 2 * 1024 * 1024;
const MAX_PARTS = 50;

type Request = Prisma.DiagnosticsRequestGetPayload<{ include: { parts: { select: { part: true; size: true } } } }>;

function mapRequest(request: Request) {
  return {
    id: request.id,
    requestId: request.requestNumber,
    machineId: request.machineId,
    machineCode: request.machineCode,
    fromDate: request.fromDate,
    toDate: request.toDate,
    status: request.status,
    note: request.note,
    requestedByRole: request.requestedByRole,
    partsExpected: request.partsExpected,
    partsReceived: request.parts.map((part) => part.part).sort((a, b) => a - b),
    bytesReceived: request.parts.reduce((total, part) => total + part.size, 0),
    receivedAt: request.receivedAt,
    createdAt: request.createdAt,
  };
}

const withParts = { parts: { select: { part: true, size: true } } } as const;

/**
 * Desktop log upload on request. The super admin (console) or the CSP (app)
 * asks a PC; the heartbeat / entitlements carry the request until the last
 * part arrives. Nothing is sent without a request. Parts are kept 14 days.
 */
export default class DiagnosticsService {
  constructor(private readonly db: PrismaDb) {}

  /** A machine the user may ask (super admin: any; CSP / BC: in its scope). By id or machine code. */
  private async machineFor(user: CurrentUser, machineIdOrCode: string) {
    const agentIds = user.role === UserRole.SUPER_ADMIN ? [] : await new AgentScopeService(this.db).getAgentScope(user);

    const machine = await this.db.machine.findFirst({
      where: {
        OR: [{ id: machineIdOrCode }, { machineCode: machineIdOrCode }],
        ...(user.role !== UserRole.SUPER_ADMIN && { agentId: { in: agentIds } }),
      },
      select: { id: true, machineCode: true },
    });

    if (!machine) {
      throw new NotFoundError("Machine not found.");
    }

    return machine;
  }

  /** Replaces an open request for the same PC (one at a time). */
  async create(user: CurrentUser, machineIdOrCode: string, input: { fromDate?: string; toDate?: string; note?: string }) {
    const machine = await this.machineFor(user, machineIdOrCode);
    const today = istDateKey(new Date());
    const toDate = input.toDate ?? today;
    const fromDate = input.fromDate ?? toDate;

    if (fromDate > toDate) {
      throw new BadRequestError("`fromDate` must be on or before `toDate`.");
    }

    if (toDate > today) {
      throw new BadRequestError("Dates can't be in the future.");
    }

    const earliest = istDateKey(addDays(new Date(`${today}T12:00:00+05:30`), -(MAX_LOG_DAYS - 1)));

    if (fromDate < earliest) {
      throw new BadRequestError(`Only the last ${MAX_LOG_DAYS} days of logs can be asked for (from ${earliest}).`, "DIAGNOSTICS_RANGE_TOO_OLD");
    }

    await this.db.diagnosticsRequest.updateMany({
      where: { machineId: machine.id, status: DiagnosticsStatus.OPEN },
      data: { status: DiagnosticsStatus.CANCELLED },
    });

    const requestNumber = await createCodeGeneratorService(this.db).generateDiagnosticsRequestNumber();

    const request = await this.db.diagnosticsRequest.create({
      data: {
        requestNumber,
        machineId: machine.id,
        machineCode: machine.machineCode,
        fromDate,
        toDate,
        note: input.note ?? null,
        requestedByUserId: user.userId,
        requestedByRole: user.role,
      },
      include: withParts,
    });

    return mapRequest(request);
  }

  async list(user: CurrentUser, filter: { machineId?: string; status?: DiagnosticsStatus; page: number; limit: number }) {
    const machine = filter.machineId ? await this.machineFor(user, filter.machineId) : null;

    if (!machine && user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestError("machineId is required.");
    }

    const where: Prisma.DiagnosticsRequestWhereInput = {
      ...(machine && { machineId: machine.id }),
      ...(filter.status && { status: filter.status }),
    };

    const [items, total] = await Promise.all([
      this.db.diagnosticsRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: withParts,
      }),
      this.db.diagnosticsRequest.count({ where }),
    ]);

    return { items: items.map(mapRequest), pagination: buildPagination(filter.page, filter.limit, total) };
  }

  private async find(id: string) {
    const request = await this.db.diagnosticsRequest.findFirst({
      where: { OR: [{ id }, { requestNumber: id }] },
      include: withParts,
    });

    if (!request) {
      throw new NotFoundError("Diagnostics request not found.");
    }

    return request;
  }

  async get(id: string) {
    return mapRequest(await this.find(id));
  }

  async cancel(id: string) {
    const request = await this.find(id);

    if (request.status === DiagnosticsStatus.OPEN) {
      await this.db.diagnosticsRequest.update({ where: { id: request.id }, data: { status: DiagnosticsStatus.CANCELLED } });
    }

    return this.get(request.id);
  }

  async part(id: string, part: number) {
    const request = await this.find(id);
    const row = await this.db.diagnosticsPart.findUnique({ where: { requestId_part: { requestId: request.id, part } } });

    if (!row) {
      throw new NotFoundError("That part hasn't arrived.");
    }

    return { request, row };
  }

  /** What the heartbeat / entitlements carry for this PC (null = nothing asked). */
  async forMachine(machineId: string) {
    const open = await this.db.diagnosticsRequest.findFirst({
      where: { machineId, status: DiagnosticsStatus.OPEN },
      orderBy: { createdAt: "desc" },
    });

    return open
      ? { uploadRequested: true, requestId: open.requestNumber, fromDate: open.fromDate, toDate: open.toDate }
      : null;
  }

  /** One part from the PC. A retry of the same part replaces it. */
  async upload(
    machineId: string,
    input: { requestId: string; part: number; parts: number; fileName: string; appVersion?: string; content: string },
  ) {
    const request = await this.db.diagnosticsRequest.findFirst({
      where: { requestNumber: input.requestId, machineId, status: DiagnosticsStatus.OPEN },
    });

    if (!request) {
      throw new NotFoundError("No open diagnostics request with that id for this PC.", "DIAGNOSTICS_REQUEST_NOT_FOUND");
    }

    if (input.part > input.parts || input.parts > MAX_PARTS) {
      throw new BadRequestError(`part must be 1–parts and parts at most ${MAX_PARTS}.`);
    }

    if (request.partsExpected && request.partsExpected !== input.parts) {
      throw new BadRequestError(`This request is being sent in ${request.partsExpected} parts.`);
    }

    const size = Buffer.byteLength(input.content, "utf8");

    if (size > MAX_PART_BYTES) {
      throw new AppError("A part can be at most 2 MB. Split it smaller.", 413, "PAYLOAD_TOO_LARGE");
    }

    const data = { parts: input.parts, fileName: input.fileName, appVersion: input.appVersion ?? null, size, content: input.content };

    await this.db.diagnosticsPart.upsert({
      where: { requestId_part: { requestId: request.id, part: input.part } },
      create: { requestId: request.id, part: input.part, ...data },
      update: data,
    });

    const received = await this.db.diagnosticsPart.count({ where: { requestId: request.id } });
    const done = received >= input.parts;

    await this.db.diagnosticsRequest.update({
      where: { id: request.id },
      data: {
        partsExpected: input.parts,
        ...(done && { status: DiagnosticsStatus.RECEIVED, receivedAt: new Date() }),
      },
    });

    return { requestId: request.requestNumber, part: input.part, received: true, complete: done };
  }

  /** Daily: requests (and their parts) older than 14 days are deleted. */
  async cleanup(now = new Date()) {
    const { count } = await this.db.diagnosticsRequest.deleteMany({
      where: { createdAt: { lt: addDays(now, -DIAGNOSTICS_KEEP_DAYS) } },
    });

    return count;
  }
}
