import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8787);

const names = {
  '0eec42dc-f73f-4e43-a62e-7e0900fcf38c': 'TEG - EU 1',
  '61dd0256-b780-40b5-a9fa-2b5bc542ce88': 'TEG - EU 2',
  '0abd34ac-c564-4d2e-9853-263d707528c3': 'TEG - NA 1',
  '33daa183-8c52-41f8-b936-b8524eaf7387': 'TEG - NA 2',
  'ff450efd-8080-4cab-a0ac-e5a3bf8fbf5f': 'TEG - Hardcore',
  '00000000-0000-4000-8000-000000000006': 'TEG - NA 3'
};

// Replace the NA 3 placeholder id with the real one to run the live fleet against the mock.
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
  const playerCount = [99, 99, 0, 100, 0, 64][i];
  const reservedSlots = [1, 1, 1, 1, 0, 0][i];
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
      map: ['Kavkazi', 'Europe', 'NorthAmerica', 'Kavkazi', null, 'NorthAmerica'][i],
      experiences: [['KOTH_Standard'], ['KOTH_Infantry'], ['Conquest'], ['KOTH_Hardcore'], null, ['KOTH_Standard']][i],
      lighting: ['Day', 'Night', 'Dawn', 'Day', null, 'Night'][i],
      alternator: ['none', 'ZoneAlternator.Europe.North', 'ZoneAlternator.NorthAmerica.Central', 'none', null, 'ZoneAlternator.NorthAmerica.East'][i],
      scoreCap: null,
      matchSeconds: 1200,
      playerCount,
      maxPlayers: [100, 100, 100, 100, null, 100][i],
      scores: [
        { name: 'Lonestar', colorHex: '#2196f3', score: [4, 6, 0, 72, null, 18][i] },
        { name: 'Valkyra', colorHex: '#f44336', score: [0, 16, 0, 0, null, 22][i] },
        { name: 'Manticore', colorHex: '#4caf50', score: [35, 51, 0, 100, null, 9][i] }
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
