// Placeholder identifiers; no audio assets are loaded until the Monde audio pass.
export const MUSIC = { mainTheme: "music_monde_main" } as const;
export type MusicKey = (typeof MUSIC)[keyof typeof MUSIC];
export interface AudioFile { key: MusicKey; src: string; }
export const MUSIC_FILES: AudioFile[] = [];
