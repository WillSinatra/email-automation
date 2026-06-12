const { isValidEmailDate } = require('../routes/dateFilter');

describe('Date Filter Logic', () => {
  // Mock 'now' to be June 12, 2026 to emulate "today"
  const mockNow = new Date('2026-06-12T12:00:00.000Z');

  test('email from May 2026 -> included', () => {
    expect(isValidEmailDate('2026-05-15T10:00:00Z', mockNow)).toBe(true);
  });

  test('email from June 2026 -> included', () => {
    expect(isValidEmailDate('2026-06-05T10:00:00Z', mockNow)).toBe(true);
  });

  test('email from April 2026 -> included', () => {
    expect(isValidEmailDate('2026-04-10T10:00:00Z', mockNow)).toBe(true);
  });

  test('email from March 2026 -> excluded', () => {
    expect(isValidEmailDate('2026-03-31T23:59:59Z', mockNow)).toBe(false);
  });

  test('email from December 2025 -> excluded', () => {
    expect(isValidEmailDate('2025-12-25T10:00:00Z', mockNow)).toBe(false);
  });

  test('email from July 2026 (future dates) -> excluded', () => {
    expect(isValidEmailDate('2026-07-01T10:00:00Z', mockNow)).toBe(false);
  });

  test('email with no date header or unparseable date -> temporarily kept', () => {
    expect(isValidEmailDate(null, mockNow)).toBe(true);
    expect(isValidEmailDate(undefined, mockNow)).toBe(true);
    expect(isValidEmailDate('', mockNow)).toBe(true);
    expect(isValidEmailDate('not-a-date', mockNow)).toBe(true);
  });
});