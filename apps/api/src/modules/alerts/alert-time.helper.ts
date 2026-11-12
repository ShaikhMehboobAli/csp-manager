import { istInstant, istParts } from "../../core/utils/ist";

/** `HH:mm` on an IST clock. */
export function istTime(date: Date) {
  const shifted = new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000);

  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/** The instant of `HH:mm` (IST) on the IST day of `day`. */
export function atIstTime(day: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const { year, month, day: date } = istParts(day);

  return istInstant(year, month, date, hours, minutes);
}
