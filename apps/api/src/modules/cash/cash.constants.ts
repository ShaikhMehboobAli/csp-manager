/** Drawer keys: the same note/coin keys as a receipt's cash denomination. */
export const DRAWER_KEYS = [
  "notes500",
  "notes200",
  "notes100",
  "notes50",
  "notes20",
  "notes10",
  "notes5",
  "coins20",
  "coins10",
  "coins5",
  "coins2",
  "coins1",
] as const;

export type DrawerKey = (typeof DRAWER_KEYS)[number];

export type Drawer = Record<DrawerKey, number>;

export const DRAWER_VALUES: Record<DrawerKey, number> = {
  notes500: 500,
  notes200: 200,
  notes100: 100,
  notes50: 50,
  notes20: 20,
  notes10: 10,
  notes5: 5,
  coins20: 20,
  coins10: 10,
  coins5: 5,
  coins2: 2,
  coins1: 1,
};

/** Why a cash receipt was saved without changing the balances. */
export const NOT_APPLIED_REASONS = {
  NOT_SET_UP: "NOT_SET_UP",
  INSUFFICIENT_CASH_IN_HAND: "INSUFFICIENT_CASH_IN_HAND",
  INSUFFICIENT_CASH_IN_ACCOUNT: "INSUFFICIENT_CASH_IN_ACCOUNT",
} as const;

export type NotAppliedReason =
  (typeof NOT_APPLIED_REASONS)[keyof typeof NOT_APPLIED_REASONS];

export function emptyDrawer(): Drawer {
  return Object.fromEntries(DRAWER_KEYS.map((key) => [key, 0])) as Drawer;
}

export function drawerOf(row: Partial<Record<DrawerKey, number>>): Drawer {
  return Object.fromEntries(
    DRAWER_KEYS.map((key) => [key, row[key] ?? 0]),
  ) as Drawer;
}

export function drawerTotal(drawer: Drawer) {
  return DRAWER_KEYS.reduce(
    (total, key) => total + drawer[key] * DRAWER_VALUES[key],
    0,
  );
}
