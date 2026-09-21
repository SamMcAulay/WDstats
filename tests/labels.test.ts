import { describe, it, expect } from 'vitest';
import { prettify, mapName, lightingLabel, expLabel, expSetLabel, zoneLabel } from '../src/labels.js';

describe('prettify', () => {
  it('splits camel case', () => {
    expect(prettify('DayClear')).toBe('Day Clear');
  });
  it('replaces separators', () => {
    expect(prettify('KOTH_InfantryOnly')).toBe('KOTH Infantry Only');
  });
  it('returns empty string for nullish input', () => {
    expect(prettify(null)).toBe('');
    expect(prettify(undefined)).toBe('');
  });
});

describe('mapName', () => {
  it('maps the three known ids to their display names', () => {
    expect(mapName('Kavkazi')).toBe('Bakurani');
    expect(mapName('Europe')).toBe('Ozeti');
    expect(mapName('NorthAmerica')).toBe('Zestafona');
  });
  it('prettifies an unknown id', () => {
    expect(mapName('SomeNewMap')).toBe('Some New Map');
  });
  it('returns a dash for nothing', () => {
    expect(mapName(null)).toBe('—');
  });
});

describe('lightingLabel', () => {
  it('prettifies lighting ids', () => {
    expect(lightingLabel('DayClear')).toBe('Day Clear');
    expect(lightingLabel('DayLateGrayFog')).toBe('Day Late Gray Fog');
  });
  it('returns a dash for nothing', () => {
    expect(lightingLabel(null)).toBe('—');
  });
});

describe('expLabel', () => {
  it('names the King of the Hill mode', () => {
    expect(expLabel('NorthAmerica_KOTH_01')).toBe('King of the Hill');
  });
  it('prettifies modifiers without the KOTH prefix', () => {
    expect(expLabel('KOTH_InfantryOnly')).toBe('Infantry Only');
    expect(expLabel('KOTH_Hardcore')).toBe('Hardcore');
  });
});

describe('expSetLabel', () => {
  it('joins the mode and its modifiers', () => {
    expect(expSetLabel(['NorthAmerica_KOTH_01', 'KOTH_Hardcore'])).toBe('King of the Hill + Hardcore');
  });
  it('handles a mode alone', () => {
    expect(expSetLabel(['NorthAmerica_KOTH_01'])).toBe('King of the Hill');
  });
  it('returns a dash for an empty list', () => {
    expect(expSetLabel([])).toBe('—');
    expect(expSetLabel(null)).toBe('—');
  });
});

describe('zoneLabel', () => {
  it('maps the map segment to its display name', () => {
    expect(zoneLabel('ZoneAlternator.NorthAmerica.Houses.Circle')).toBe('Zestafona Houses Circle');
  });
  it('handles the documented Bakurani example', () => {
    expect(zoneLabel('ZoneAlternator.Bakurani.Default.Circle')).toBe('Bakurani Default Circle');
  });
  it('returns Default for none or nothing', () => {
    expect(zoneLabel('None')).toBe('Default');
    expect(zoneLabel(null)).toBe('Default');
    expect(zoneLabel('')).toBe('Default');
  });
});
