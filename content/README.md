# content/

Authored game data, compiled or validated at build time.

- `residents/` persona cards (YAML), schema in `shared/src/persona.ts` (GDD §9.3)
- `places/` place registry (GDD §9.5)
- `scenes/` scripted scenes in the §13.1 format
- `projects.yaml` the Spring Projects (GDD §6.3; MVP G-03): cost, materials, hours, puzzle, leads, site, completion and the
  opening ceremony; parsed by `client/src/projects/schema.ts`, cross-checked by `tools/lint-content.ts`
- `items.yaml` the Bag's items, Project materials among them
- `lines/` the Quiet Mode line library (GDD Appendix B)
  - `lines/scripted.yaml` the canned exchanges Quiet Mode plays for the story's `{ai_open}` cues (schema in its header; GDD §13.1)
