import { describe, expect, it } from 'vitest';
import { FREE_ATTEMPTS, PinLock, isValidPin, lockoutMs, type KeyValueStore } from './pin';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('PinLock', () => {
  it('never stores the PIN itself', async () => {
    const store = memoryStore();
    await new PinLock(store).setPin('482913');
    expect([...store.data.values()].join()).not.toContain('482913');
  });

  it('accepts the right PIN and rejects a wrong one', async () => {
    const lock = new PinLock(memoryStore());
    await lock.setPin('1234');
    expect((await lock.verify('1234')).ok).toBe(true);
    expect((await lock.verify('4321')).ok).toBe(false);
  });

  it('changes the PIN only when the current PIN is correct', async () => {
    const lock = new PinLock(memoryStore());
    await lock.setPin('1111');
    expect((await lock.changePin('9999', '2222')).ok).toBe(false);
    expect((await lock.verify('1111')).ok).toBe(true);
    expect((await lock.changePin('1111', '2222')).ok).toBe(true);
    expect((await lock.verify('2222')).ok).toBe(true);
    expect((await lock.verify('1111')).ok).toBe(false);
  });

  it('makes you wait after too many wrong attempts, even with the right PIN', async () => {
    let now = 1_000_000;
    const lock = new PinLock(memoryStore(), () => now);
    await lock.setPin('1234');
    for (let i = 0; i < FREE_ATTEMPTS; i++) await lock.verify('0000');
    expect(lock.waitMs()).toBe(30_000);
    expect((await lock.verify('1234')).ok).toBe(false); // still locked out
    now += 30_001;
    expect((await lock.verify('1234')).ok).toBe(true);
    expect(lock.waitMs()).toBe(0);
  });

  it('validates PIN format', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
  });

  it('grows the lockout and caps it at an hour', () => {
    expect(lockoutMs(FREE_ATTEMPTS - 1)).toBe(0);
    expect(lockoutMs(FREE_ATTEMPTS + 1)).toBe(60_000);
    expect(lockoutMs(50)).toBe(3_600_000);
  });
});

describe('passcode on / off', () => {
  it('can be skipped, turned on, and turned off only with the right PIN', async () => {
    const store = memoryStore();
    const lock = new PinLock(store);
    expect(lock.hasPin()).toBe(false);
    lock.skipSetup();
    expect(lock.skipped()).toBe(true);
    await lock.setPin('2468');
    expect([lock.hasPin(), lock.skipped()]).toEqual([true, false]);
    expect((await lock.turnOff('1111')).ok).toBe(false);
    expect(lock.hasPin()).toBe(true);
    expect((await lock.turnOff('2468')).ok).toBe(true);
    expect([lock.hasPin(), lock.skipped()]).toEqual([false, true]);
  });
  it('auto-lock can be set to never', () => {
    const lock = new PinLock(memoryStore());
    lock.setAutoLockMinutes(-1);
    expect(lock.autoLockMinutes()).toBe(-1);
  });
});
