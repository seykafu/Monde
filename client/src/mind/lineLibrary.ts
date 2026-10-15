// The Quiet Mode line library (GDD Appendix B), loaded like the zones and places: a Vite raw import of the
// YAML, parsed and checked once at boot so a broken line fails loudly rather than mid-conversation.
import linesYaml from '../../../content/lines/lines.yaml?raw';
import { parse } from 'yaml';
import { parseLineLibrary, type LineLibrary } from './quietMode';

export const lineLibrary: LineLibrary = parseLineLibrary(parse(linesYaml));
