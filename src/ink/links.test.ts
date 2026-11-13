import { describe, expect, it } from 'vitest';
import { describeLink, normalizeUrl } from './links';

describe('links', () => {
  it('cleans up typed web addresses and refuses unsafe ones', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('http://a.org/x?y=1')).toBe('http://a.org/x?y=1');
    expect(normalizeUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a link')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
  it('describes links briefly', () => {
    expect(describeLink({ kind: 'url', url: 'https://www.example.com/docs' })).toBe('example.com/docs');
    expect(describeLink({ kind: 'page', pageId: 'p2' }, () => 2)).toBe('Page 2');
    expect(describeLink({ kind: 'notebook', notebookId: 'n' }, undefined, () => 'Physics')).toBe('Physics');
  });
});
