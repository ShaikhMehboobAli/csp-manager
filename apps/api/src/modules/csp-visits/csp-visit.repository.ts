import { PrismaDb } from "../../core/database/prisma.types";
import { CreateCspVisitInput } from "./csp-visit.dto";

export default class CspVisitRepository {
  constructor(private readonly db: PrismaDb) {}

  async create(
    data: CreateCspVisitInput & {
      visitedByAgentId: string;
      visitId: string;
    },
  ) {
    return this.db.cspVisit.create({
      data: {
        visitId: data.visitId,

        cspAgentId: data.cspAgentId,

        visitedByAgentId: data.visitedByAgentId,

        visitDate: data.visitDate,

        latitude: data.latitude,

        longitude: data.longitude,

        photoUrl: data.photoUrl,

        remarks: data.remarks,

        customerReviews: {
          create: data.customerReviews.map((review) => ({
            customerName: review.customerName,

            customerAccount: review.customerAccount,

            review: review.review,
          })),
        },
      },

      include: {
        customerReviews: true,
      },
    });
  }

  async findById(id: string) {
    return this.db.cspVisit.findUnique({
      where: {
        id,
      },
      include: {
        customerReviews: true,
      },
    });
  }

  async findByVisitId(visitId: string) {
    return this.db.cspVisit.findUnique({
      where: {
        visitId,
      },
      include: {
        customerReviews: true,
      },
    });
  }

  async findManyByCsp(cspAgentId: string, from?: Date, to?: Date) {
    return this.db.cspVisit.findMany({
      where: {
        cspAgentId,

        ...(from || to
          ? {
              visitDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },

      include: {
        customerReviews: true,
      },

      orderBy: {
        visitDate: "desc",
      },
    });
  }

  async findByCspAndDateRange(cspAgentId: string, from: Date, to: Date) {
    return this.db.cspVisit.findFirst({
      where: {
        cspAgentId,
        visitDate: {
          gte: from,
          lte: to,
        },
      },
      include: {
        customerReviews: true,
      },
    });
  }
}
