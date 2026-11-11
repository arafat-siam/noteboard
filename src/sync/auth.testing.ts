/** Test helper: pretend Google sign-in happened (tests run without a browser sign-in). */
export function setToken(): void {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as { localStorage: typeof ls }).localStorage = ls;
  ls.setItem('noteboard.google.token', JSON.stringify({ accessToken: 'test', expiresAt: Date.now() + 3_600_000 }));
  ls.setItem('noteboard.google.connected', '1');
}
