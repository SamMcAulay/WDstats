import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

function validEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    WARCON_BASE_URL: 'https://panel.example.com/',
    WARCON_TOKEN: 'warcon-key'
  };
  for (let i = 1; i <= 5; i++) {
    env[`BOT${i}_TOKEN`] = `token-${i}`;
    env[`BOT${i}_SERVER_ID`] = `server-${i}`;
    env[`BOT${i}_GUILD_IDS`] = `guild-${i}`;
  }
  return env;
}

describe('loadConfig', () => {
  it('parses five bot bindings', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.bots).toHaveLength(5);
    expect(cfg.bots[0]!.serverId).toBe('server-1');
    expect(cfg.bots[4]!.token).toBe('token-5');
  });

  it('strips a trailing slash from the base url', () => {
    expect(loadConfig(validEnv()).warconBaseUrl).toBe('https://panel.example.com');
  });


  it('splits comma-separated guild ids and trims them', () => {
    const env = validEnv();
    env.BOT2_GUILD_IDS = ' a , b ,, c ';
    expect(loadConfig(env).bots[1]!.guildIds).toEqual(['a', 'b', 'c']);
  });

  it('defaults the name template to {name}', () => {
    expect(loadConfig(validEnv()).bots[0]!.nameTemplate).toBe('{name}');
  });

  it('applies timing defaults', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.pollIntervalMs).toBe(15000);
    expect(cfg.staleAfterMs).toBe(90000);
    expect(cfg.requestTimeoutMs).toBe(10000);
  });

  it('lists every missing variable in one error', () => {
    const env = validEnv();
    delete env.WARCON_TOKEN;
    delete env.BOT3_SERVER_ID;
    expect(() => loadConfig(env)).toThrow(/WARCON_TOKEN[\s\S]*BOT3_SERVER_ID/);
  });

  it('rejects a half-configured Cloudflare service token', () => {
    const env = validEnv();
    env.CF_ACCESS_CLIENT_ID = 'id.access';
    expect(() => loadConfig(env)).toThrow(/CF_ACCESS_CLIENT_SECRET/);
  });

  it('accepts both Cloudflare values together', () => {
    const env = validEnv();
    env.CF_ACCESS_CLIENT_ID = 'id.access';
    env.CF_ACCESS_CLIENT_SECRET = 'secret';
    const cfg = loadConfig(env);
    expect(cfg.cfAccessClientId).toBe('id.access');
    expect(cfg.cfAccessClientSecret).toBe('secret');
  });

  it('accepts neither Cloudflare value', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.cfAccessClientId).toBeNull();
  });
});
