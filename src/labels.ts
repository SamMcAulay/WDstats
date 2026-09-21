/**
 * Display labels for the raw ids Warcon returns. Ported from Warcon's own
 * src/lib/format.ts so our output matches the panel exactly.
 */

const MAP_DISPLAY: Record<string, string> = {
  Kavkazi: 'Bakurani',
  Europe: 'Ozeti',
  NorthAmerica: 'Zestafona'
};

export function prettify(id: string | null | undefined): string {
  if (!id) return '';
  return String(id)
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapName(id: string | null | undefined): string {
  if (!id) return '—';
  return MAP_DISPLAY[id] ?? prettify(id) ?? '—';
}

export function lightingLabel(id: string | null | undefined): string {
  return prettify(id) || '—';
}

export const isMod = (id: string): boolean => /infantry|hardcore/i.test(id);

export function expLabel(id: string): string {
  if (/koth/i.test(id)) {
    return isMod(id) ? prettify(id.replace(/^KOTH_/i, '')) : 'King of the Hill';
  }
  return prettify(id);
}

export function expSetLabel(ids: string[] | null | undefined): string {
  const list = ids ?? [];
  if (list.length === 0) return '—';
  const mode = list.find((id) => !isMod(id));
  return [mode ? expLabel(mode) : null, ...list.filter(isMod).map(expLabel)]
    .filter((part): part is string => Boolean(part))
    .join(' + ');
}

export function zoneLabel(tag: string | null | undefined): string {
  if (!tag || /^none$/i.test(tag)) return 'Default';
  const parts = String(tag)
    .replace(/^ZoneAlternator\./i, '')
    .split('.')
    .filter(Boolean);
  const mapped = parts.map((part, i) => (i === 0 ? (MAP_DISPLAY[part] ?? part) : part));
  return prettify(mapped.join(' ')) || 'Default';
}
