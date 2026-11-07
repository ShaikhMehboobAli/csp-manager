import { PrismaDb } from "../../../core/database/prisma.types";
import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import { AgentStatus, AgentType, CashLoginMethod } from "../../../generated/prisma/enums";
import CashRepository from "../../cash/cash.repository";
import { AuthenticatedMachine } from "../runtime/machine-auth.dto";

import { maskEmail } from "./agent-email-otp.service";

export type FamilyAgent = {
  agentId: string;
  name: string;
  type: AgentType;
  email: string | null;
  emailMasked: string | null;
  emailVerified: boolean;
};

/**
 * The agents allowed to use a PC: the CSP that owns it (its pool) and all
 * of that CSP's KOs. Any of them may log in to SBI on any PC of the family;
 * agents of another CSP may not. Cash management follows whoever is logged
 * in (`Machine.cashAgentId`), else the PC's own agent.
 */
export default class MachineFamilyService {
  constructor(private readonly db: PrismaDb) {}

  async cspOf(authenticated: AuthenticatedMachine) {
    const agentId = authenticated.machine.currentAgentId;

    if (!agentId) {
      return null;
    }

    return new CashRepository(this.db).findPoolCspId(agentId);
  }

  async agents(authenticated: AuthenticatedMachine): Promise<FamilyAgent[]> {
    const cspAgentId = await this.cspOf(authenticated);

    if (!cspAgentId) {
      return [];
    }

    const rows = await this.db.agent.findMany({
      where: {
        isDeleted: false,
        status: AgentStatus.ACTIVE,
        OR: [
          { agentId: cspAgentId, type: AgentType.CSP },
          { parentAgentId: cspAgentId, type: AgentType.KO },
        ],
      },
      select: { agentId: true, name: true, type: true, email: true, emailVerifiedAt: true },
      orderBy: [{ type: "asc" }, { agentId: "asc" }],
    });

    return rows.map((row) => ({
      agentId: row.agentId,
      name: row.name,
      type: row.type,
      email: row.email,
      emailMasked: maskEmail(row.email),
      emailVerified: !!row.email && !!row.emailVerifiedAt,
    }));
  }

  async requireMember(authenticated: AuthenticatedMachine, agentId: string) {
    const member = (await this.agents(authenticated)).find((agent) => agent.agentId === agentId);

    if (!member) {
      throw new ForbiddenError(
        "This agent can't use this PC: only the CSP that owns it and its KOs can.",
        "AGENT_NOT_IN_FAMILY",
      );
    }

    return member;
  }

  /** Whose cash this PC shows now: the logged-in agent, else the PC's own. */
  async cashAgentOf(authenticated: AuthenticatedMachine) {
    const { machine } = authenticated;
    const fallback = machine.currentAgentId;
    const loggedIn = (machine as { cashAgentId?: string | null }).cashAgentId;

    if (!loggedIn || loggedIn === fallback) {
      return { agentId: fallback, method: loggedIn ? (machine as { cashAgentLoginMethod?: CashLoginMethod | null }).cashAgentLoginMethod ?? null : null };
    }

    const members = await this.agents(authenticated);

    if (!members.some((agent) => agent.agentId === loggedIn)) {
      // Removed from the family (deleted / moved): back to the PC's agent.
      await this.setCashAgent(machine.id, null, null);

      return { agentId: fallback, method: null };
    }

    return {
      agentId: loggedIn,
      method: (machine as { cashAgentLoginMethod?: CashLoginMethod | null }).cashAgentLoginMethod ?? null,
    };
  }

  setCashAgent(machineId: string, agentId: string | null, method: CashLoginMethod | null) {
    return this.db.machine.update({
      where: { id: machineId },
      data: {
        cashAgentId: agentId,
        cashAgentLoginMethod: method,
        cashAgentLoginAt: agentId ? new Date() : null,
      },
    });
  }
}
