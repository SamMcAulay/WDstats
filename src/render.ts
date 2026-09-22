import { mapName, lightingLabel, expSetLabel, zoneLabel } from './labels.js';
import type { Snapshot } from './store.js';
import type { WarconLive, WarconStatus } from './types.js';

export const BAR_WIDTH = 10;
export const BIO_MAX = 400;
export const NICK_MAX = 32;

const FILLED = '▰';
const EMPTY = '▱';

/** A bar scaled to the leading faction, so the leader is always full. */
export function bar(score: number, max: number, width: number = BAR_WIDTH): string {
  if (max <= 0) return EMPTY.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((score / max) * width)));
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/**
 * maxPlayers is the TOTAL slot count, with reservedSlots held back INSIDE it,
 * so the public cap is maxPlayers - reservedSlots. Confirmed against the live
 * builds: maxPlayers reads 100 whether or not slots are reserved.
 * 99 players, 100 total, 2 reserved -> "99 / 100 +1 reserved online".
 */
export function formatSlots(
  playerCount: number,
  maxPlayers: number,
  reservedSlots: number | null
): string {
  const reserved = reservedSlots ?? 0;
  const publicCap = Math.max(0, maxPlayers - reserved);
  const overflow = Math.max(0, playerCount - publicCap);
  const base = `${playerCount} / ${maxPlayers}`;
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

export function hhmmUtc(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export interface Policy {
  nameTemplate: string;
  joinCodeFallback: string | null;
}

export interface Presentation {
  nickname: string;
  activity: string;
  bio: string;
}

export function renderName(template: string, live: WarconLive | null): string {
  const serverName = live?.status?.serverName ?? '';
  const rendered = template.replace(/\{name\}/g, serverName).trim();
  return rendered || serverName || 'Wardogs';
}

export function offlineText(lastOkAt: number | null): string {
  return lastOkAt === null ? 'offline' : `offline · last seen ${hhmmUtc(lastOkAt)}`;
}

export function activityText(live: WarconLive): string {
  const status = live.status!;
  return formatSlots(status.playerCount, status.maxPlayers, live.reservedSlots);
}

function joinCodeLine(live: WarconLive | null, fallback: string | null): string {
  const code = (live?.gameServerId || '').trim() || fallback || '';
  return `Join code: ${code || 'unavailable'}`;
}

export function factionLines(joinLine: string, status: WarconStatus): string[] {
  const lines = [joinLine];
  const max = Math.max(0, ...status.scores.map((s) => s.score));
  for (const faction of status.scores) {
    lines.push(`${bar(faction.score, max)} ${faction.score} ${faction.name}`);
  }
  const context = contextLine(status);
  if (context) lines.push(context);
  return lines;
}

export function render(snapshot: Snapshot, policy: Policy): Presentation {
  const live = snapshot.live;
  const nickname = truncate(renderName(policy.nameTemplate, live), NICK_MAX);
  const joinLine = joinCodeLine(live, policy.joinCodeFallback);

  if (!live || !live.status) {
    return {
      nickname,
      activity: offlineText(snapshot.lastOkAt),
      bio: fitLines([joinLine], BIO_MAX)
    };
  }

  const lines = factionLines(joinLine, live.status);

  if (!snapshot.fresh) {
    lines.push(`⚠ ${offlineText(snapshot.lastOkAt)}`);
  }

  return {
    nickname,
    activity: snapshot.fresh ? activityText(live) : offlineText(snapshot.lastOkAt),
    bio: fitLines(lines, BIO_MAX)
  };
}
