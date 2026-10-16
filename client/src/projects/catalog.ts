// content/projects.yaml, loaded like the other content (Vite raw import + the yaml parser) and parsed once.
import YAML from 'yaml';
import raw from '../../../content/projects.yaml?raw';
import { parseProjects, type ProjectDef, type ProjectsContent } from './schema';

export const PROJECT_CONTENT: ProjectsContent = parseProjects(YAML.parse(raw));
export const PROJECTS: readonly ProjectDef[] = PROJECT_CONTENT.projects;
/** MVP_PLAN's Spring Projects: everything in the file (the lighthouse is the stretch one). */
export const projectDef = (id: string): ProjectDef | undefined => PROJECTS.find(p => p.id === id.split(':')[0]);
