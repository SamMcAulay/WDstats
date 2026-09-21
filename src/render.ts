import { mapName, lightingLabel, expSetLabel, zoneLabel } from './labels.js';
import type { BioMode } from './config.js';
import type { Snapshot } from './store.js';
import type { WarconLive, WarconPlayer, WarconStatus } from './types.js';

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

export type Phase = { kind: 'slots' } | { kind: 'faction'; index: number };

/** Bots 2-5: slots only. */
export const SLOTS_ONLY_PHASES: Phase[] = [{ kind: 'slots' }];

/** Bot 1: the 3:1:1:1 ratio as six phases. */
export const ROTATING_PHASES: Phase[] = [
  { kind: 'slots' },
  { kind: 'slots' },
  { kind: 'slots' },
  { kind: 'faction', index: 0 },
  { kind: 'faction', index: 1 },
  { kind: 'faction', index: 2 }
];

export interface Policy {
  bioMode: BioMode;
  activityPhases: Phase[];
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

export function activityText(live: WarconLive, phase: Phase): string {
  const status = live.status!;
  const slots = formatSlots(status.playerCount, status.maxPlayers, live.reservedSlots);
  if (phase.kind === 'slots') return slots;
  const faction = status.scores[phase.index];
  return faction ? `${faction.name} ${faction.score}` : slots;
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

export function scoreboardLines(joinLine: string, players: WarconPlayer[]): string[] {
  const lines = [joinLine];
  const top = topPlayers(players);
  if (top.length === 0) {
    lines.push('No players online');
    return lines;
  }
  top.forEach((p, i) => {
    lines.push(`${i + 1}. ${truncate(p.name, NAME_MAX)} ${p.kills}-${p.deaths}`);
  });
  return lines;
}

export function render(snapshot: Snapshot, policy: Policy, tick: number): Presentation {
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

  const phases = policy.activityPhases.length > 0 ? policy.activityPhases : SLOTS_ONLY_PHASES;
  const phase = phases[tick % phases.length]!;

  const lines =
    policy.bioMode === 'scoreboard'
      ? scoreboardLines(joinLine, live.players)
      : factionLines(joinLine, live.status);

  if (!snapshot.fresh) {
    lines.push(`⚠ ${offlineText(snapshot.lastOkAt)}`);
  }

  return {
    nickname,
    activity: snapshot.fresh ? activityText(live, phase) : offlineText(snapshot.lastOkAt),
    bio: fitLines(lines, BIO_MAX)
  };
}
