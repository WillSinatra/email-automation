const { getValidDateRange, isValidEmailDate, getRangeLabel } = require('../routes/dateFilter');

describe('Date Filter Logic', () => {
  test('minDate is always first day of 2 months ago', () => {
    const now = new Date();
    const { minDate } = getValidDateRange();
    const expected = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    expect(minDate.getFullYear()).toBe(expected.getFullYear());
    expect(minDate.getMonth()).toBe(expected.getMonth());
    expect(minDate.getDate()).toBe(1);
  });

  test('maxDate is always last day of current month', () => {
    const now = new Date();
    const { maxDate } = getValidDateRange();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    expect(maxDate.getDate()).toBe(lastDay.getDate());
    expect(maxDate.getMonth()).toBe(now.getMonth());
  });

  test('handles year boundary correctly', () => {
    const { minDate, maxDate } = getValidDateRange();
    expect(maxDate >= minDate).toBe(true);
    const diffMonths =
      (maxDate.getFullYear() - minDate.getFullYear()) * 12 +
      (maxDate.getMonth() - minDate.getMonth());
    expect(diffMonths).toBe(2);
  });

  test('getRangeLabel returns string with year', () => {
    const label = getRangeLabel();
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/\d{4}/);
  });

  test('isValidEmailDate accepts email from last month', () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    expect(isValidEmailDate(lastMonth.toISOString())).toBe(true);
  });

  test('isValidEmailDate rejects email from 4 months ago', () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 4);
    expect(isValidEmailDate(old.toISOString())).toBe(false);
  });

  test('isValidEmailDate accepts email from current month', () => {
    expect(isValidEmailDate(new Date().toISOString())).toBe(true);
  });

  test('isValidEmailDate rejects null and undefined', () => {
    expect(isValidEmailDate(null)).toBe(false);
    expect(isValidEmailDate(undefined)).toBe(false);
    expect(isValidEmailDate('')).toBe(false);
  });
});