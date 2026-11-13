import { describe, expect, it } from 'vitest';
import { describePages, parsePageRange } from './pageRange';

describe('parsePageRange', () => {
  it('reads single pages, ranges and open ranges', () => {
    expect(parsePageRange('1', 5)).toEqual([0]);
    expect(parsePageRange('1-3, 5', 5)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('4-', 6)).toEqual([3, 4, 5]);
    expect(parsePageRange('-2', 6)).toEqual([0, 1]);
  });
  it('skips duplicates and pages that do not exist', () => {
    expect(parsePageRange('2, 2, 1-3, 9', 3)).toEqual([1, 0, 2]);
  });
  it('rejects nonsense', () => {
    expect(parsePageRange('', 3)).toBeNull();
    expect(parsePageRange('abc', 3)).toBeNull();
    expect(parsePageRange('0', 3)).toBeNull();
    expect(parsePageRange('7', 3)).toBeNull();
  });
  it('describes page lists for file names', () => {
    expect(describePages([2])).toBe('p3');
    expect(describePages([0, 1, 2, 3])).toBe('p1-4');
    expect(describePages([5, 0, 1, 2])).toBe('p1-3,6');
  });
});
