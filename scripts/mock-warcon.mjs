import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8787);

const names = {
  '0eec42dc-f73f-4e43-a62e-7e0900fcf38c': 'TEG - EU 1',
  '61dd0256-b780-40b5-a9fa-2b5bc542ce88': 'TEG - EU 2',
  '0abd34ac-c564-4d2e-9853-263d707528c3': 'TEG - NA 1',
  '33daa183-8c52-41f8-b936-b8524eaf7387': 'TEG - NA 2',
  'ff450efd-8080-4cab-a0ac-e5a3bf8fbf5f': 'TEG - Hardcore'
};

const ids = Object.keys(names);

function players(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      name: `Player${i + 1}`,
      steamId: `7656119${String(i).padStart(10, '0')}`,
      faction: i % 2 === 0 ? 'Valkyra' : 'Lonestar',
      kills: Math.max(0, 40 - i * 3),
      deaths: 5 + i,
      cash: 1000 * (10 - i),
      ping: 30 + i
    });
  }
  return out;
}

function live(id, i) {
  // server 5 simulates an offline/errored server
  if (i === 4) {
    return {
      serverId: id, ok: false, error: 'server offline', tier: 'standard',
      build: '1.4.2', gameServerId: '', startedAt: null, reservedSlots: null,
      throttledUntil: null, status: null, players: [], observedAt: new Date().toISOString()
    };
  }
  const playerCount = [64, 99, 12, 100][i];
  const reservedSlots = [0, 2, 4, 4][i];
  return {
    serverId: id,
    ok: true,
    error: '',
    tier: 'standard',
    build: '1.4.2',
    gameServerId: `MOCK-${i + 1}`,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    reservedSlots,
    throttledUntil: null,
    status: {
      serverName: names[id],
      map: ['Kavkazi', 'Europe', 'NorthAmerica', 'Kavkazi'][i],
      experiences: [['KOTH_Standard'], ['KOTH_Infantry'], ['Conquest'], ['KOTH_Hardcore']][i],
      lighting: ['Day', 'Night', 'Dawn', 'Day'][i],
      alternator: ['none', 'ZoneAlternator.Europe.North', 'ZoneAlternator.NorthAmerica.Central', 'none'][i],
      scoreCap: 1000,
      matchSeconds: 1200,
      playerCount,
      maxPlayers: [64, 100, 64, 100][i],
      scores: [
        { name: 'Valkyra', colorHex: '#4488ff', score: [620, 410, 180, 950][i] },
        { name: 'Lonestar', colorHex: '#ff6644', score: [480, 700, 220, 300][i] }
      ]
    },
    players: players(Math.min(playerCount, 10)),
    observedAt: new Date().toISOString()
  };
}

createServer((req, res) => {
  const m = /^\/api\/servers\/([^/]+)\/summary$/.exec(req.url ?? '');
  res.setHeader('content-type', 'application/json');
  if (!m) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: { message: 'not found' } })); return; }
  const id = decodeURIComponent(m[1]);
  const i = ids.indexOf(id);
  if (i < 0) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: { message: 'unknown server' } })); return; }
  if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
    res.statusCode = 403; res.end(JSON.stringify({ ok: false, error: { message: 'missing bearer' } })); return;
  }
  res.end(JSON.stringify({ ok: true, live: live(id, i) }));
}).listen(PORT, '127.0.0.1', () => console.log(`mock warcon on http://127.0.0.1:${PORT}`));
