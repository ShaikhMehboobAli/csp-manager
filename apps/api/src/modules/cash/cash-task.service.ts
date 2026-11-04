import { PrismaDb } from "../../core/database/prisma.types";
import { ConflictError } from "../../core/errors/ConflictError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { Prisma } from "../../generated/prisma/client";
import { CashLabelDirection, CashTaskCreator } from "../../generated/prisma/enums";

type Task = Prisma.CashTaskGetPayload<object>;

const DONE_KEEP_DAYS = 30;

export type TaskStatus = "OPEN" | "DONE" | "ALL";

export type TaskChange = {
  title?: string;
  note?: string | null;
  dueAt?: Date | null;
  done?: boolean;
};

/**
 * Tasks shared by an agent and its CSP. The agent manages its own (KO) and
 * can only tick the CSP's done; the CSP manages the ones it gave (CSP).
 * Task text is free text: never logged.
 */
export class CashTaskService {
  constructor(private readonly db: PrismaDb) {}

  /** Open first (soonest due, then no due time, oldest first), then done (newest first). */
  async list(agentIds: string[], status: TaskStatus) {
    const doneSince = new Date(Date.now() - DONE_KEEP_DAYS * 86_400_000);

    const [open, done] = await Promise.all([
      status === "DONE"
        ? Promise.resolve([])
        : this.db.cashTask.findMany({
            where: { agentId: { in: agentIds }, done: false },
            orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
            include: { agent: { select: { name: true } } },
          }),
      status === "OPEN"
        ? Promise.resolve([])
        : this.db.cashTask.findMany({
            where: { agentId: { in: agentIds }, done: true, doneAt: { gte: doneSince } },
            orderBy: { doneAt: "desc" },
            include: { agent: { select: { name: true } } },
          }),
    ]);

    return [...open, ...done].map((task) => ({ ...this.map(task), agentName: task.agent.name }));
  }

  /** For the heartbeat: open, overdue, and the CSP's tasks the agent hasn't seen. */
  async counts(agentId: string) {
    const now = new Date();
    const row = await this.db.agentCash.findUnique({
      where: { agentId },
      select: { tasksReadAt: true },
    });

    const [openCount, overdueCount, newFromCspCount] = await Promise.all([
      this.db.cashTask.count({ where: { agentId, done: false } }),
      this.db.cashTask.count({ where: { agentId, done: false, dueAt: { lt: now } } }),
      this.db.cashTask.count({
        where: {
          agentId,
          done: false,
          createdBy: CashTaskCreator.CSP,
          ...(row?.tasksReadAt && { createdAt: { gt: row.tasksReadAt } }),
        },
      }),
    ]);

    return { openCount, overdueCount, newFromCspCount };
  }

  /** The agent read its task list ("new from the CSP" starts again from 0). */
  markRead(agentId: string) {
    return this.db.agentCash.updateMany({ where: { agentId }, data: { tasksReadAt: new Date() } });
  }

  create(input: {
    cspAgentId: string;
    agentId: string;
    title: string;
    note?: string | null;
    dueAt?: Date | null;
    createdBy: CashTaskCreator;
    createdById: string;
  }) {
    return this.db.cashTask
      .create({
        data: {
          cspAgentId: input.cspAgentId,
          agentId: input.agentId,
          title: input.title,
          note: input.note ?? null,
          dueAt: input.dueAt ?? null,
          createdBy: input.createdBy,
          createdById: input.createdById,
        },
      })
      .then((task) => this.map(task));
  }

  /** `by` = who is changing it; `agentIds` = the tasks they can reach. */
  async update(input: { taskId: string; agentIds: string[]; by: CashTaskCreator; change: TaskChange }) {
    const task = await this.find(input.taskId, input.agentIds);
    const { change } = input;

    const onlyDone =
      change.title === undefined && change.note === undefined && change.dueAt === undefined;

    if (task.createdBy !== input.by && !(input.by === CashTaskCreator.KO && onlyDone)) {
      throw new ForbiddenError(
        input.by === CashTaskCreator.KO
          ? "This task is from your CSP. Only they can change it."
          : "This task is the agent's own. Only they can change it.",
      );
    }

    const updated = await this.db.cashTask.update({
      where: { id: task.id },
      data: {
        ...(change.title !== undefined && { title: change.title }),
        ...(change.note !== undefined && { note: change.note }),
        ...(change.dueAt !== undefined && { dueAt: change.dueAt }),
        ...(change.done !== undefined && {
          done: change.done,
          doneAt: change.done ? (task.done ? task.doneAt : new Date()) : null,
        }),
      },
    });

    return this.map(updated);
  }

  async remove(input: { taskId: string; agentIds: string[]; by: CashTaskCreator }) {
    const task = await this.find(input.taskId, input.agentIds);

    if (task.createdBy !== input.by) {
      throw new ForbiddenError(
        input.by === CashTaskCreator.KO
          ? "This task is from your CSP. Only they can change it."
          : "This task is the agent's own. Only they can change it.",
      );
    }

    await this.db.cashTask.delete({ where: { id: task.id } });
  }

  private async find(taskId: string, agentIds: string[]) {
    const task = await this.db.cashTask.findFirst({
      where: { id: taskId, agentId: { in: agentIds } },
    });

    if (!task) {
      throw new NotFoundError("That task isn't there any more.");
    }

    return task;
  }

  map(task: Task) {
    return {
      id: task.id,
      agentId: task.agentId,
      title: task.title,
      note: task.note,
      dueAt: task.dueAt,
      done: task.done,
      doneAt: task.doneAt,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

/** The CSP's labels for custom transactions. */
export class CashLabelService {
  constructor(private readonly db: PrismaDb) {}

  list(cspAgentId: string) {
    return this.db.cashLabel.findMany({
      where: { cspAgentId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
  }

  async create(cspAgentId: string, input: { name: string; direction: CashLabelDirection }) {
    await this.requireFreeName(cspAgentId, input.name);

    return this.db.cashLabel.create({ data: { cspAgentId, ...input } });
  }

  async update(
    cspAgentId: string,
    labelId: string,
    change: { name?: string; direction?: CashLabelDirection; active?: boolean },
  ) {
    const label = await this.db.cashLabel.findFirst({ where: { id: labelId, cspAgentId } });

    if (!label) {
      throw new NotFoundError("Label not found.");
    }

    if (change.name !== undefined && change.name.toLowerCase() !== label.name.toLowerCase()) {
      await this.requireFreeName(cspAgentId, change.name);
    }

    return this.db.cashLabel.update({ where: { id: label.id }, data: change });
  }

  private async requireFreeName(cspAgentId: string, name: string) {
    const taken = await this.db.cashLabel.findFirst({
      where: { cspAgentId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });

    if (taken) {
      throw new ConflictError("A label with this name already exists.");
    }
  }
}
