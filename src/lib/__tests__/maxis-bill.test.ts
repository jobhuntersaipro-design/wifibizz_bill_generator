import { describe, expect, it } from 'vitest';
import { maxisLineNumber, monthShift, shiftDates } from '../bill-generator/maxis-bill';

describe('maxis bill', () => {
  it('moves the statement to the month before today (Malaysia time)', () => {
    // Template statement is 10/05/2026; on 28 Oct 2026 the bill is for September.
    const k = monthShift(new Date('2026-10-28T03:00:00Z'));
    expect(shiftDates('10/05/2026', k)).toBe('10/09/2026');
    // 31 Oct 17:00 UTC is already 1 Nov in Malaysia.
    expect(shiftDates('10/05/2026', monthShift(new Date('2026-10-31T17:00:00Z')))).toBe('10/10/2026');
  });

  it('shifts both date forms inside a longer run, across a year, clamping the day', () => {
    expect(shiftDates('10/04/26 - 09/05/26', 9)).toBe('10/01/27 - 09/02/27');
    expect(shiftDates('30/04/2026', 10)).toBe('28/02/2027');
  });

  it('prints a customer mobile the way the bill does', () => {
    expect(maxisLineNumber('+60137089093')).toBe('6013 7089093');
    expect(maxisLineNumber('011-2345 6789')).toBe('6011 23456789');
    expect(maxisLineNumber('0387654321')).toBeNull();
  });
});

describe('allo bill dates', () => {
  it('invoices on the 1st of the current Malaysia month and bills the whole month', async () => {
    const { alloDates } = await import('../bill-generator/allo-bill');
    expect(alloDates(new Date('2026-10-28T03:00:00Z'))).toEqual({
      invoice: '1 October 2026',
      due: '1 November 2026',
      period: '01/10/2026 - 31/10/2026',
    });
    // 31 Dec 17:00 UTC is already 1 Jan in Malaysia; February 2027 has 28 days.
    expect(alloDates(new Date('2026-12-31T17:00:00Z')).due).toBe('1 February 2027');
    expect(alloDates(new Date('2027-02-10T00:00:00Z')).period).toBe('01/02/2027 - 28/02/2027');
  });
});
