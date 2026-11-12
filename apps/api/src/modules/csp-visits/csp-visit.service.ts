import CspVisitRepository from "./csp-visit.repository";
import { istInstant, istParts } from "../../core/utils/ist";
import { CreateCspVisitInput } from "./csp-visit.dto";
import CodeGeneratorService from "../../core/services/code-generator.service";
import RunningNumberRepository from "../../core/repositories/running-number.repository";
// import { AgentScopeService } from "../agents/services/agent-scope.service";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { PrismaDb } from "../../core/database/prisma.types";
import AgentScopeService from "../agents/service/agent-scope.service";
import S3StorageService from "../uploads/storage/s3.storage";
import UploadService from "../uploads/upload.service";
import { NotFoundError } from "../../core/errors/NotFoundError";

export default class CspVisitService {
  private readonly visitRepository: CspVisitRepository;

  private readonly codeGeneratorService: CodeGeneratorService;

  private readonly scopeService: AgentScopeService;

  private readonly storageService: S3StorageService;

  constructor(private readonly db: PrismaDb) {
    const runningNumberRepository = new RunningNumberRepository(db);

    this.visitRepository = new CspVisitRepository(db);

    this.codeGeneratorService = new CodeGeneratorService(
      runningNumberRepository,
    );

    this.scopeService = new AgentScopeService(db);
    this.storageService = new S3StorageService();
  }

  async createVisit(
    input: CreateCspVisitInput,
    visitedByAgentId: string,
    accessibleAgentIds: string[],
  ) {
    if (input.customerReviews.length < 5) {
      throw new BadRequestError("At least 5 customer reviews are required.");
    }

    this.scopeService.ensureAgentAccessible(
      input.cspAgentId,
      accessibleAgentIds,
    );

    const csp = await this.db.agent.findUnique({
      where: {
        agentId: input.cspAgentId,
      },
      select: {
        agentId: true,
        name: true,
        type: true,
        isDeleted: true,
      },
    });

    if (!csp || csp.isDeleted || csp.type !== "CSP") {
      throw new BadRequestError("Invalid CSP agent.");
    }

    // One visit per CSP per IST calendar month.
    const { year, month } = istParts(new Date(input.visitDate));

    const monthStart = istInstant(year, month, 1);

    const monthEnd = istInstant(year, month + 1, 0, 23, 59, 59, 999);

    const existingVisit = await this.visitRepository.findByCspAndDateRange(
      input.cspAgentId,
      monthStart,
      monthEnd,
    );

    if (existingVisit) {
      throw new BadRequestError(
        "A CSP visit has already been recorded for this month.",
      );
    }

    if (input.photoUrl) {
      // The photo must have been uploaded by the visitor.
      if (!UploadService.isOwnedBy(input.photoUrl, visitedByAgentId)) {
        throw new BadRequestError("Invalid CSP visit photo.");
      }

      const photoExists = await this.storageService.objectExists(
        input.photoUrl,
      );

      if (!photoExists) {
        throw new BadRequestError("CSP visit photo was not found in storage.");
      }
    }

    const visitId = await this.codeGeneratorService.generateCspVisitNumber();

    return this.visitRepository.create({
      ...input,
      visitedByAgentId,
      visitId,
    });
  }

  async getVisit(id: string, accessibleAgentIds: string[]) {
    const visit = await this.visitRepository.findById(id);

    // Hide visits outside the caller's scope (empty scope = SUPER_ADMIN).
    if (
      !visit ||
      (accessibleAgentIds.length > 0 &&
        !accessibleAgentIds.includes(visit.cspAgentId))
    ) {
      throw new NotFoundError("CSP visit not found.");
    }

    let photoUrl = visit.photoUrl;

    if (visit.photoUrl) {
      photoUrl = await this.storageService.createPresignedDownloadUrl(
        visit.photoUrl,
      );
    }

    return {
      ...visit,
      photoUrl,
    };
  }

  async getVisitByVisitId(visitId: string) {
    const visit = await this.visitRepository.findByVisitId(visitId);

    if (!visit) {
      throw new BadRequestError("CSP visit not found.");
    }

    return visit;
  }

  async getCspVisits(cspAgentId: string, from?: Date, to?: Date) {
    return this.visitRepository.findManyByCsp(cspAgentId, from, to);
  }
}
