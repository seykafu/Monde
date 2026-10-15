import oldQuarter from '../../../content/zones/old_quarter.zone.yaml?raw';
import marketRow from '../../../content/zones/market_row.zone.yaml?raw';
import wharf from '../../../content/zones/wharf.zone.yaml?raw';
import commons from '../../../content/zones/commons.zone.yaml?raw';
import { compileZone, validateZoneLinks } from './zoneFormat';
export const zones = Object.fromEntries([oldQuarter, marketRow, wharf, commons].map(text => { const zone = compileZone(text); return [zone.id, zone]; }));
validateZoneLinks(zones);
