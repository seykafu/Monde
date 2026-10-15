import { STANDARD_EXPRESSIONS } from "../../persona";
import { makeRegistry } from "../registry";

/** Header used by most tests. The heading is file line 1, the header lines 3–11, the body starts at line 14. */
export const HEADER = [
  "id: t_scene",
  "day: 3",
  'time: "09:00-10:30"',
  "place: old_quarter.library",
  'trigger: "day >= 3"',
  "backdrop: bg_library",
  "music: library_hush",
  "cast: [pell, margo, bru]",
  "sets: []",
].join("\n");

export const BODY_LINE = 14;

export function sceneSource(body: string, header = HEADER): string {
  return `#### T · Test scene\n\`\`\`yaml\n${header}\n\`\`\`\n\`\`\`script\n${body}\n\`\`\`\n`;
}

export const reg = makeRegistry({
  flags: ["t_done", "met_margo_early", "pz03_solved", "return_ticket_torn", "oq1_opened"],
  residents: {
    pell: [...STANDARD_EXPRESSIONS, "stiff_smile", "ledger_stare"],
    margo: [...STANDARD_EXPRESSIONS, "deadpan", "lit_up"],
    tib: [...STANDARD_EXPRESSIONS],
    nell: [...STANDARD_EXPRESSIONS, "arms_crossed", "squint_sea"],
  },
  places: ["old_quarter.library", "wharf.ferry_slip"],
});
