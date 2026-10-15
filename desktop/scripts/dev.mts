// `npm run desktop:dev`: the game in Electron with live reload.
//   1. The client's Vite dev server: HMR reloads the game as client files change.
//   2. tsc --watch on desktop/src.
//   3. Electron pointed at the dev server (MONDE_DEV_SERVER_URL), restarted when the main process or preload
//      output changes.
// Extra arguments go to Electron (e.g. `npm run desktop:dev -- --invite=CODE`). Ctrl+C or closing the window
// stops everything.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { writeBuildConfig } from './build-config.mjs';

const desktop = path.resolve(import.meta.dirname, '..');
const root = path.resolve(desktop, '..');
const dist = path.join(desktop, 'dist');
const require = createRequire(import.meta.url);
const devUrl = process.env.MONDE_DEV_SERVER_URL ?? 'http://localhost:5173';
const win = process.platform === 'win32';

const children = new Set<ChildProcess>();
let stopping = false;

function run(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  // Own process group (POSIX), so stopping npm also stops the Vite it started.
  const child = spawn(command, args, { stdio: 'inherit', detached: !win, shell: win && command === 'npm', ...options });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch { child.kill(); }
}

function stop(code = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child);
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

async function waitForServer(url: string, vite: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error('the Vite dev server exited');
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** tsc --watch, resolved once its first build is done. */
function compileWatch(): Promise<void> {
  const tsc = require.resolve('typescript/bin/tsc');
  const child = run(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { cwd: desktop, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (/Watching for file changes/.test(text)) resolve();
    });
    child.on('exit', () => reject(new Error('tsc exited')));
  });
}

/** The compiled main process and preload, so a rewrite with the same output doesn't restart the app. */
function outputHash(): string {
  const hash = createHash('sha1');
  for (const name of readdirSync(dist).filter(n => n.endsWith('.js')).sort()) hash.update(name).update(readFileSync(path.join(dist, name)));
  return hash.digest('hex');
}

let electron: ChildProcess | null = null;
let restarting = false;
let built = '';

function startElectron(): void {
  built = outputHash();
  const binary = require('electron') as unknown as string;
  electron = run(binary, ['.', ...process.argv.slice(2)], { cwd: desktop, detached: false, env: { ...process.env, MONDE_DEV_SERVER_URL: devUrl } });
  electron.on('exit', code => { if (!restarting) stop(code ?? 0); });
}

function restartElectron(): void {
  if (outputHash() === built) return;
  console.log('desktop: main process changed, restarting Electron');
  const old = electron;
  if (!old || old.exitCode !== null) { startElectron(); return; }
  restarting = true;
  old.once('exit', () => { restarting = false; startElectron(); });
  old.kill();
}

async function main(): Promise<void> {
  console.log(`desktop: monde-mind at ${writeBuildConfig()}`);
  const vite = run('npm', ['run', 'dev', '-w', '@monde/client'], { cwd: root });
  await Promise.all([waitForServer(devUrl, vite), compileWatch()]);
  startElectron();
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(dist, (_event, file) => {
    if (!file?.toString().endsWith('.js')) return;
    clearTimeout(timer);
    timer = setTimeout(restartElectron, 400);
  });
}

main().catch(error => {
  console.error(`desktop: ${error instanceof Error ? error.message : String(error)}`);
  stop(1);
});
