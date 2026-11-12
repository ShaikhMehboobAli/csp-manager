import { Prisma } from "../../generated/prisma/client";

import { DRAWER_KEYS, Drawer } from "./cash.constants";

export const D = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export const ZERO = D(0);

export const money = (value: Prisma.Decimal) => Number(value.toFixed(2));

export const rupees = (value: Prisma.Decimal) => `₹${value.toFixed(2)}`;

export const NOT_SET_UP_MESSAGE =
  "Cash management isn't set up for this CSP yet. The CSP sets the cash limit, cash in account and cash in hand first.";

/** Drawer counts change; never below 0. Returns the new drawer and the applied change. */
export function moveDrawer(
  drawer: Drawer,
  denomination: Partial<Drawer> | null | undefined,
  sign: 1 | -1,
) {
  const next = { ...drawer };
  const change: Partial<Drawer> = {};

  if (!denomination) {
    return { drawer: next, change: null };
  }

  for (const key of DRAWER_KEYS) {
    const count = denomination[key] ?? 0;

    if (!count) {
      continue;
    }

    const updated = Math.max(0, drawer[key] + sign * count);

    if (updated !== drawer[key]) {
      change[key] = updated - drawer[key];
      next[key] = updated;
    }
  }

  return {
    drawer: next,
    change: Object.keys(change).length > 0 ? change : null,
  };
}

export function drawerChangeBetween(before: Drawer, after: Drawer) {
  const change: Partial<Drawer> = {};

  for (const key of DRAWER_KEYS) {
    if (after[key] !== before[key]) {
      change[key] = after[key] - before[key];
    }
  }

  return Object.keys(change).length > 0 ? change : null;
}

