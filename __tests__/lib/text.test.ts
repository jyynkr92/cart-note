import { normalizeInviteCode, normalizeName } from '@/src/lib/text';

describe('normalizeInviteCode', () => {
  it('keeps digits only', () => {
    expect(normalizeInviteCode(' 012 345 ')).toBe('012345');
    expect(normalizeInviteCode('12-34-56')).toBe('123456');
  });
  it('rejects wrong lengths', () => {
    expect(normalizeInviteCode('01234')).toBeNull();
    expect(normalizeInviteCode('1234567')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
  });
});

describe('normalizeName', () => {
  it('trims and rejects blank', () => {
    expect(normalizeName('  민지 ')).toBe('민지');
    expect(normalizeName('   ')).toBeNull();
  });
});
