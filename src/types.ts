/** Mirrors Warcon's src/lib/types.ts for the fields we consume. */

export interface FactionScore {
  name: string;
  colorHex: string;
  score: number;
}

export interface WarconStatus {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string;
  alternator: string;
  scoreCap: number | null;
  matchSeconds: number | null;
  playerCount: number;
  maxPlayers: number;
  scores: FactionScore[];
}

export interface WarconPlayer {
  name: string;
  steamId: string;
  faction: string | null;
  kills: number;
  deaths: number;
  cash: number;
  ping: number | null;
}

export interface WarconLive {
  serverId: string;
  ok: boolean;
  error: string;
  tier: string;
  build: string;
  /** join code from GET /v1/server-id; '' when the build does not serve it */
  gameServerId: string;
  startedAt: string | null;
  /** MaxReservedSlots — held back INSIDE status.maxPlayers, not on top of it */
  reservedSlots: number | null;
  throttledUntil: string | null;
  status: WarconStatus | null;
  players: WarconPlayer[];
  observedAt: string | null;
}
