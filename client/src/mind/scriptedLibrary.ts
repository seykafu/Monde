// The scripted Quiet Mode exchanges for the story's {ai_open} cues (content/lines/scripted.yaml), loaded like the
// line library: a Vite raw import of the YAML, parsed and checked once at boot so a broken exchange fails loudly
// rather than mid-scene.
import scriptedYaml from '../../../content/lines/scripted.yaml?raw';
import { parse } from 'yaml';
import { parseScriptedLibrary, type ScriptedLibrary } from './scripted';

export const scriptedLibrary: ScriptedLibrary = parseScriptedLibrary(parse(scriptedYaml));
