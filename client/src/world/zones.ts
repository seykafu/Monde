import oldQuarter from '../../../content/zones/old_quarter.zone.yaml?raw';
import marketRow from '../../../content/zones/market_row.zone.yaml?raw';
import wharf from '../../../content/zones/wharf.zone.yaml?raw';
import commons from '../../../content/zones/commons.zone.yaml?raw';
import { compileZone, validateZoneLinks, type ZoneDef } from './zoneFormat';
import { linkInteriors, type DoorLink } from './interiors';
/** The town's outdoor boards (the zone graph residents walk). */
export const zones = Object.fromEntries([oldQuarter, marketRow, wharf, commons].map(text => { const zone = compileZone(text); return [zone.id, zone]; }));
validateZoneLinks(zones);

// The rooms behind the buildings' doors (MVP W-03, zone `kind: interior`; world/interiors.ts).
const roomFiles = import.meta.glob('../../../content/zones/interiors/*.zone.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const interiors: Readonly<Record<string, ZoneDef>> = Object.fromEntries(Object.keys(roomFiles).sort().map(path => {
  const zone = compileZone(roomFiles[path]!);
  return [zone.id, zone];
}));
/** Every building door with a room behind it. */
export const doorLinks: readonly DoorLink[] = linkInteriors(zones, interiors);
/** Every board the player can stand on: the districts and the rooms. */
export const boards: Readonly<Record<string, ZoneDef>> = { ...zones, ...interiors };
