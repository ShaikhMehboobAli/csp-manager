// Transaction Controller service names, upper case with "_". The first six are
// automated today; the rest are listed in the controller for later.
export const DESKTOP_SERVICE_CODES = [
  "BALANCE_ENQUIRY",
  "MINI_STATEMENT",
  "CASH_WITHDRAWAL",
  "CASH_DEPOSIT",
  "MONEY_TRANSFER",
  "PASSBOOK_PRINTING",
  "FUND_TRANSFER",
  "TRANSACTION_HISTORY",
  "KYC_UPDATION",
  "ACCOUNT_OPENING",
  "AADHAAR_SEEDING",
  "AEPS_REGISTRATION",
] as const;

export type DesktopServiceCode = (typeof DESKTOP_SERVICE_CODES)[number];

// AppSetting key holding DesktopSettings.
export const DESKTOP_SETTINGS_KEY = "desktop";
