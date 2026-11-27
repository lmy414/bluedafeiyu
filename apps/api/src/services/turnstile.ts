export function createTurnstile(secret?: string, request: typeof fetch = fetch) {
  return {
    async verify(token: unknown, remoteIp?: string): Promise<boolean> {
      if (!secret) return true;
      if (typeof token !== 'string' || !token || token.length > 2048) return false;
      try {
        const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
        });
        if (!response.ok) return false;
        const result = await response.json() as { success?: boolean };
        return result.success === true;
      } catch { return false; }
    },
  };
}
