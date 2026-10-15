import { FLAG_PATTERNS, registryFromContent } from "@monde/shared";
import flagsYaml from "../../../content/flags.yaml?raw";

const declared = registryFromContent({ flagsYaml, residentYamls: [] }).flags;

export interface StoryDiagnostics {
  dev?: boolean;
  warn?: (message: string) => void;
}

/** Uses the same declarations and rule patterns as the content compiler. */
export class FlagStore {
  private flags = new Set<string>();
  readonly dev: boolean;
  readonly warn: (message: string) => void;

  constructor(options: StoryDiagnostics = {}) {
    this.dev = options.dev ?? import.meta.env.DEV;
    this.warn = options.warn ?? console.warn;
  }

  private valid(flag: string): boolean {
    if (declared.has(flag) || FLAG_PATTERNS.some((pattern) => pattern.test(flag))) return true;
    const message = `Unknown story flag: ${flag}`;
    if (this.dev) throw new Error(message);
    this.warn(message);
    return false;
  }

  has(flag: string): boolean { return this.valid(flag) && this.flags.has(flag); }
  set(flag: string): void { if (this.valid(flag)) this.flags.add(flag); }
  unset(flag: string): void { if (this.valid(flag)) this.flags.delete(flag); }
  snapshot(): ReadonlySet<string> { return new Set(this.flags); }
  serialize(): string[] { return [...this.flags].sort(); }
  restore(flags: readonly string[]): void {
    // Validate first: a bad development save must not partially replace the store.
    const restored = flags.filter((flag) => this.valid(flag));
    this.flags = new Set(restored);
  }
}
