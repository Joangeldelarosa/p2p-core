import { generateId, generateRoomCode } from '../../src/utils/id';

describe('generateId', () => {
  it('returns a UUID v4 string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, generateId));
    expect(ids.size).toBe(100);
  });
});

describe('generateRoomCode', () => {
  it('returns a 6-character upper-case string', () => {
    const code = generateRoomCode();
    expect(typeof code).toBe('string');
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('returns unique values', () => {
    const codes = new Set(Array.from({ length: 50 }, generateRoomCode));
    expect(codes.size).toBeGreaterThan(40);
  });
});
