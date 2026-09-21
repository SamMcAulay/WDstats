import { mapName, lightingLabel, expSetLabel, zoneLabel } from './labels.js';
import type { WarconPlayer, WarconStatus } from './types.js';

export const BAR_WIDTH = 10;
export const BIO_MAX = 400;
export const NICK_MAX = 32;
export const NAME_MAX = 20;
export const TOP_N = 5;

const FILLED = '▰';
const EMPTY = '▱';

/** A bar scaled to the leading faction, so the leader is always full. */
export function bar(score: number, max: number, width: number = BAR_WIDTH): string {
  if (max <= 0) return EMPTY.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((score / max) * width)));
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/**
 * maxPlayers is the PUBLIC cap; reservedSlots sit on top of it (Warcon types.ts).
 * 99 players, cap 98, 2 reserved -> "99 / 100 +1 reserved online".
 */
export function formatSlots(
  playerCount: number,
  maxPlayers: number,
  reservedSlots: number | null
): string {
  const reserved = reservedSlots ?? 0;
  const total = maxPlayers + reserved;
  const overflow = Math.max(0, playerCount - maxPlayers);
  const base = `${playerCount} / ${total}`;
  return overflow > 0 ? `${base} +${overflow} reserved online` : base;
}

export function contextLine(status: WarconStatus): string {
  return [
    mapName(status.map),
    lightingLabel(status.lighting),
    expSetLabel(status.experiences),
    zoneLabel(status.alternator)
  ]
    .filter((part) => part && part !== '—')
    .join(' · ');
}

export function truncate(text: string, max: number): string {
  const value = text ?? '';
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + '…';
}

/** Drops whole trailing lines to fit the budget rather than cutting mid-line. */
export function fitLines(lines: string[], max: number): string {
  const kept: string[] = [];
  for (const line of lines) {
    if ([...kept, line].join('\n').length > max) break;
    kept.push(line);
  }
  // Nothing fit: the first line alone exceeds the budget, so cut it rather
  // than returning an empty string.
  if (kept.length === 0) {
    const first = lines[0];
    return first === undefined ? '' : first.slice(0, max);
  }
  return kept.join('\n');
}

/** Kills desc, then fewer deaths, then name — the ordering Warcon itself applies. */
export function topPlayers(players: WarconPlayer[], n: number = TOP_N): WarconPlayer[] {
  return [...players]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function hhmmUtc(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
