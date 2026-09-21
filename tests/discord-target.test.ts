import { describe, it, expect, vi } from 'vitest';
import { DiscordJsTarget } from '../src/discord-target.js';

function fakeClient() {
  return {
    user: { setActivity: vi.fn() },
    rest: { patch: vi.fn(async () => ({})) }
  };
}

/** A client whose nickname PATCH rejects for the named guilds only. */
function clientFailingIn(...guildIds: string[]) {
  const client = fakeClient();
  client.rest.patch = vi.fn(async (route: string) => {
    const failing = guildIds.find((id) => route === `/guilds/${id}/members/@me`);
    if (failing) throw new Error(`Unknown Guild (${failing})`);
    return {};
  }) as never;
  return client;
}

function fakeLog() {
  return { warn: vi.fn() };
}

describe('DiscordJsTarget', () => {
  it('sets a Playing activity', async () => {
    const client = fakeClient();
    await new DiscordJsTarget(client as never, ['g1']).setActivity('99 / 100');
    expect(client.user.setActivity).toHaveBeenCalledWith('99 / 100', { type: 0 });
  });

  it('patches the nickname in every configured guild', async () => {
    const client = fakeClient();
    await new DiscordJsTarget(client as never, ['g1', 'g2']).setNickname('TEG - NA 2');
    expect(client.rest.patch).toHaveBeenCalledTimes(2);
    expect(client.rest.patch).toHaveBeenCalledWith('/guilds/g1/members/@me', { body: { nick: 'TEG - NA 2' } });
    expect(client.rest.patch).toHaveBeenCalledWith('/guilds/g2/members/@me', { body: { nick: 'TEG - NA 2' } });
  });

  it('patches the remaining guilds when an earlier guild fails', async () => {
    const client = clientFailingIn('g1');
    const target = new DiscordJsTarget(client as never, ['g1', 'g2', 'g3'], fakeLog());
    await target.setNickname('TEG - NA 2').catch(() => {});
    const paths = (client.rest.patch as never as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => c[0]
    );
    expect(paths).toContain('/guilds/g2/members/@me');
    expect(paths).toContain('/guilds/g3/members/@me');
  });

  it('resolves when at least one guild succeeds', async () => {
    const client = clientFailingIn('g1');
    const target = new DiscordJsTarget(client as never, ['g1', 'g2'], fakeLog());
    await expect(target.setNickname('TEG - NA 2')).resolves.toBeUndefined();
  });

  it('throws when every guild fails', async () => {
    const client = clientFailingIn('g1', 'g2');
    const target = new DiscordJsTarget(client as never, ['g1', 'g2'], fakeLog());
    await expect(target.setNickname('TEG - NA 2')).rejects.toThrow(/g1.*g2/s);
  });

  it('warns once for a standing per-guild failure, not on every call', async () => {
    const client = clientFailingIn('g1');
    const log = fakeLog();
    const target = new DiscordJsTarget(client as never, ['g1', 'g2'], log);
    await target.setNickname('first');
    await target.setNickname('second');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toContain('g1');
  });

  it('patches the application description for the bio', async () => {
    const client = fakeClient();
    await new DiscordJsTarget(client as never, ['g1']).setBio('Join code: abc');
    expect(client.rest.patch).toHaveBeenCalledWith('/applications/@me', { body: { description: 'Join code: abc' } });
  });

  it('never touches the global username', async () => {
    const client = fakeClient();
    const target = new DiscordJsTarget(client as never, ['g1']);
    await target.setNickname('TEG - NA 2');
    await target.setBio('x');
    const paths = client.rest.patch.mock.calls.map((c) => c[0]);
    expect(paths).not.toContain('/users/@me');
  });
});
