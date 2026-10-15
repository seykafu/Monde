// Persona cards (GDD §9.3), loaded like the zones: Vite raw glob imports + the yaml parser, then checked
// against the shared PersonaCard schema so a broken card fails loudly at boot rather than mid-day.
import { parse } from 'yaml';
import { PersonaCard } from '@monde/shared';

const files = import.meta.glob('../../../content/residents/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const personaCards: readonly PersonaCard[] = Object.keys(files).sort().map(path => {
  const result = PersonaCard.safeParse(parse(files[path]!));
  if (!result.success) throw new Error(`${path}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return result.data;
});
