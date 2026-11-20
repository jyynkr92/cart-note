import { normalizeInviteCode, normalizeName } from '@/src/lib/text';

describe('normalizeInviteCode', () => {
  it('keeps digits only', () => {
    expect(normalizeInviteCode(' 0123 4567 ')).toBe('01234567');
    expect(normalizeInviteCode('1234-5678')).toBe('12345678');
  });
  it('rejects wrong lengths', () => {
    expect(normalizeInviteCode('123456')).toBeNull();
    expect(normalizeInviteCode('1234567')).toBeNull();
    expect(normalizeInviteCode('123456789')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
  });
});

describe('normalizeName', () => {
  it('trims and rejects blank', () => {
    expect(normalizeName('  민지 ')).toBe('민지');
    expect(normalizeName('   ')).toBeNull();
  });
});
