import { endOfIstDay, startOfIstDay } from "./ist";

// export function normalizeDateRange(from?: Date, to?: Date) {
//   const today = new Date();
//   today.setUTCHours(0, 0, 0, 0);

//   const start = from ?? today;

//   const end = to ? new Date(to) : undefined;

//   if (end) {
//     end.setUTCHours(23, 59, 59, 999);
//   }

//   return {
//     from: start,
//     to: end,
//   };
// }

// export function normalizeDateRange(from?: Date | string, to?: Date | string) {
//   const today = new Date();
//   today.setUTCHours(0, 0, 0, 0);

//   const start = from ? new Date(from) : today;

//   start.setUTCHours(0, 0, 0, 0);

//   const end = to ? new Date(to) : undefined;

//   if (end) {
//     end.setUTCHours(23, 59, 59, 999);
//   }

//   return {
//     from: start,
//     to: end,
//   };
// }

// Whole IST days covering [from, to]; both default to today (IST).
export function normalizeDateRange(from?: Date, to?: Date) {
  const today = new Date();

  return {
    from: startOfIstDay(from ?? today),
    to: endOfIstDay(to ?? today),
  };
}
