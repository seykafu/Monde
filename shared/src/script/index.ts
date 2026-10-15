// Scene-script parser and compiler (GDD §13.1). Pure TS: no Node or DOM APIs, so client, server and tools share it.
export * from "./types";
export { parseCommand, parseArgs, COMMAND_NAMES, closest } from "./commands";
export { parseHeader } from "./header";
export { parseScene, type ParseResult } from "./parse";
export * from "./registry";
export * from "./compile";
