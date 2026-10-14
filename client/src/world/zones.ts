import oldQuarter from '../../../content/zones/old_quarter.zone.yaml?raw';
import marketRow from '../../../content/zones/market_row.zone.yaml?raw';
import { compileZone, validateZoneLinks } from './zoneFormat';
export const zones = Object.fromEntries([oldQuarter, marketRow].map(text => { const zone = compileZone(text); return [zone.id, zone]; }));
validateZoneLinks(zones);
