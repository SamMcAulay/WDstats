import { describe, it, expect, vi } from 'vitest';
import { DiscordJsTarget } from '../src/discord-target.js';

function fakeClient() {
  return {
    user: { setActivity: vi.fn() },
    rest: { patch: vi.fn(async () => ({})) }
  };
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
