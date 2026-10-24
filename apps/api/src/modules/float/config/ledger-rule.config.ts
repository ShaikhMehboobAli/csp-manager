import { TransactionCategory } from "../../../generated/prisma/enums";

export enum CashEffect {
  CASH_IN = "CASH_IN",

  CASH_OUT = "CASH_OUT",

  MANUAL = "MANUAL",

  NONE = "NONE",
}

export interface LedgerRule {
  /**
   * How this transaction affects the financial balance.
   */
  cashEffect: CashEffect;

  /**
   * Should a FloatLedger entry be created?
   */
  createLedger: boolean;

  /**
   * Should AgentFloat be updated?
   */
  updateAgentFloat: boolean;

  /**
   * Should this transaction be shown in Dashboard/Reports?
   */
  showInDashboard: boolean;
}

export const LEDGER_RULES: Record<TransactionCategory, LedgerRule> = {
  CASH_WITHDRAWAL: {
    cashEffect: CashEffect.CASH_OUT,
    createLedger: true,
    updateAgentFloat: true,
    showInDashboard: true,
  },

  CASH_DEPOSIT: {
    cashEffect: CashEffect.CASH_IN,
    createLedger: true,
    updateAgentFloat: true,
    showInDashboard: true,
  },

  MONEY_TRANSFER: {
    cashEffect: CashEffect.CASH_IN,
    createLedger: true,
    updateAgentFloat: true,
    showInDashboard: true,
  },

  FUND_TRANSFER: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  BALANCE_ENQUIRY: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  MINI_STATEMENT: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  ACCOUNT_OPENING: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  BBPS: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  MICRO_ATM: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  SOCIAL_SECURITY: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  LOAN: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },

  OTHER: {
    cashEffect: CashEffect.NONE,
    createLedger: false,
    updateAgentFloat: false,
    showInDashboard: true,
  },
};
