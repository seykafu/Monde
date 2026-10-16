/** World-only access conditions, transcribed from §14.4–§14.8. Typing a name does not bypass the lighthouse Project. */
export interface WorldRiddleFacts {
  flags: ReadonlySet<string>; items: ReadonlySet<string>; regard: Readonly<Record<string, number>>;
  minute: number; weather?: string; wind?: string; lowTide?: boolean; ferryDay?: boolean; clockStep?: number;
}
export function canFindAnswer(id: string, f: WorldRiddleFacts): boolean {
  const hour = (f.minute % 1440) / 60;
  switch (id) {
    case 'OQ-5': return f.clockStep === 78;
    case 'MR-2': return (f.regard.roz ?? 0) >= 10 || f.items.has('kasimir_ladder');
    case 'MR-3': return (f.regard.odile ?? 0) >= 10 || hour < 6 && f.items.has('flour');
    case 'MR-5': return f.wind === 'W' && f.items.has('kasimir_ladder');
    case 'WF-1': return f.lowTide === true;
    case 'WF-3': return (f.regard.nell ?? 0) >= 20 || f.ferryDay === true;
    case 'WF-4': return f.flags.has('project_lighthouse_done');
    // GDD-GAP: §14.6 says “after dark”; 20:00 follows the Spring evening light transition.
    case 'WF-5': return f.flags.has('project_lighthouse_done') && (hour >= 20 || hour < 6) && ['sun', 'cloud', 'wind'].includes(f.weather ?? '');
    case 'CM-2': return f.weather === 'sun' && hour >= 15 && hour < 16 && f.items.has('trowel');
    case 'CM-4': return f.items.has('wellies') || f.flags.has('project_community_garden_done');
    default: return true;
  }
}
