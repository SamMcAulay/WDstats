import { describe, it, expect, vi } from 'vitest';
import { WarconClient, CloudflareBlockedError, WarconAuthError } from '../src/warcon.js';
import type { WarconLive } from '../src/types.js';

const live: Partial<WarconLive> = { serverId: 's1', ok: true, gameServerId: 'code-1' };

function client(fetchImpl: typeof fetch) {
  return new WarconClient({
    baseUrl: 'https://panel.example.com',
    token: 'warcon-key',
    cfClientId: 'id.access',
    cfClientSecret: 'secret',
    timeoutMs: 1000,
    fetchImpl
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('WarconClient', () => {
  it('sends all three auth headers', async () => {
    const spy = vi.fn(async () => jsonResponse({ ok: true, live }));
    await client(spy as unknown as typeof fetch).fetchServer('s1');
    const init = spy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer warcon-key');
    expect(headers['CF-Access-Client-Id']).toBe('id.access');
    expect(headers['CF-Access-Client-Secret']).toBe('secret');
  });

  it('omits Cloudflare headers when not configured', async () => {
    const spy = vi.fn(async () => jsonResponse({ ok: true, live }));
    const bare = new WarconClient({
      baseUrl: 'https://panel.example.com',
      token: 'warcon-key',
      fetchImpl: spy as unknown as typeof fetch
    });
    await bare.fetchServer('s1');
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['CF-Access-Client-Id']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer warcon-key');
  });

  it('builds the summary url', async () => {
    const spy = vi.fn(async () => jsonResponse({ ok: true, live }));
    await client(spy as unknown as typeof fetch).fetchServer('abc-123');
    expect(spy.mock.calls[0]![0]).toBe('https://panel.example.com/api/servers/abc-123/summary');
  });

  it('returns the live payload', async () => {
    const result = await client((async () => jsonResponse({ ok: true, live })) as unknown as typeof fetch)
      .fetchServer('s1');
    expect(result.gameServerId).toBe('code-1');
  });

  it('names a Cloudflare Access redirect', async () => {
    const redirect = async () =>
      new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } });
    await expect(client(redirect as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(CloudflareBlockedError);
  });

  it('names a Cloudflare Access HTML body', async () => {
    const html = async () =>
      new Response('<!DOCTYPE html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(client(html as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(/blocked by Cloudflare Access/);
  });

  it('distinguishes a Warcon auth rejection', async () => {
    const denied = async () => jsonResponse({ error: { message: 'nope' } }, 403);
    await expect(client(denied as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(WarconAuthError);
  });

  it('throws a plain error on 500', async () => {
    const boom = async () => jsonResponse({ error: { message: 'boom' } }, 500);
    const err = await client(boom as unknown as typeof fetch).fetchServer('s1').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CloudflareBlockedError);
    expect(err).not.toBeInstanceOf(WarconAuthError);
  });

  it('throws when the body carries no live data', async () => {
    const empty = async () => jsonResponse({ ok: false, error: { message: 'Not observed yet.' } });
    await expect(client(empty as unknown as typeof fetch).fetchServer('s1'))
      .rejects.toThrow(/Not observed yet/);
  });
});
