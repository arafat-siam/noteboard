import { describe, expect, it } from 'vitest';
import { fromBase64, isSealed, seal, toBase64, unseal, WrongPasscodeError } from './seal';

describe('encrypted shares', () => {
  it('only opens with the right passcode, and hides the content', async () => {
    const data = new TextEncoder().encode('my secret diary entry');
    const sealed = await seal(data, 'blue horse 7');
    expect(isSealed(sealed)).toBe(true);
    expect(new TextDecoder('latin1').decode(sealed)).not.toContain('secret');
    expect(new TextDecoder().decode(await unseal(sealed, 'blue horse 7'))).toBe('my secret diary entry');
    await expect(unseal(sealed, 'blue horse')).rejects.toBeInstanceOf(WrongPasscodeError);
  });
  it('round-trips base64 for large data', () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 7919) % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
  });
});
