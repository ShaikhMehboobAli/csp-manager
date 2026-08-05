import { TransactionCategory } from "../../../generated/prisma/enums";
import { LEDGER_RULES } from "./ledger-rule.config";

export function getLedgerRule(category?: TransactionCategory) {
  if (!category) {
    return undefined;
  }

  return LEDGER_RULES[category];
}
