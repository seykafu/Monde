import YAML from 'yaml';
import { ItemCatalog } from '@monde/shared';
import raw from '../../../content/items.yaml?raw';
export const items = ItemCatalog.parse(YAML.parse(raw));
export const itemById = (id: string) => items.find(i => i.id === id);
