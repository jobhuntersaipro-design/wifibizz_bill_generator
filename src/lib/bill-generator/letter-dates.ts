/**
 * The three dates the authorization letter carries.
 *
 * The letter date is simply when it was generated. The effective date — when the
 * resident is said to have moved in — is the one with a rule, because it must
 * never fall after the letter date: a letter cannot authorize a residence that
 * has not begun yet.
 */

import { hashSeed, makeRng } from './owner-identity';

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** `22nd AUGUST 2026` — the form the letter is headed with. */
export function ordinalDate(d: Date): string {
  const day = d.getDate();
  return `${day}${ordinalSuffix(day)} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `1 AUGUST 2026` — the form the effective clause uses. */
export function longDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `22/08/2026` — the form both signature blocks are dated with. */
export function slashDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * When the resident is said to have moved in. Seeded on the case number, so the
 * same case keeps the same story.
 *
 * - Letter dated the 3rd or later: a day in `1 … min(10, today)` of that month.
 * - Letter dated the 1st or 2nd: a day 1–10 of the *previous* month. Clamping
 *   would collapse the window to today itself, and a tenancy that began the same
 *   morning the letter was written reads as fabricated.
 *
 * Rolling back from January also decrements the year, which `new Date(y, -1, d)`
 * handles.
 */
export function effectiveDate(caseNo: string, letterDate: Date): Date {
  const rng = makeRng(hashSeed(`effective:${caseNo}`));
  const letterDay = letterDate.getDate();

  if (letterDay >= 3) {
    const maxDay = Math.min(10, letterDay);
    const day = 1 + Math.floor(rng() * maxDay);
    return new Date(letterDate.getFullYear(), letterDate.getMonth(), Math.min(day, maxDay));
  }

  const day = 1 + Math.floor(rng() * 10);
  return new Date(letterDate.getFullYear(), letterDate.getMonth() - 1, Math.min(day, 10));
}
