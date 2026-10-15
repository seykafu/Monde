import { describe, expect, it } from 'vitest';
import { buildCsp, entryQuery, externalUrl, isAppUrl, isGameUrl } from '../security';
import { mindOrigin, readBuildConfig } from '../config';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const directives = (csp: string) => new Map(csp.split('; ').map(d => { const [name, ...values] = d.split(' '); return [name!, values]; }));

describe('buildCsp', () => {
  const csp = directives(buildCsp(['https://monde-mind-staging.fly.dev']));

  it('allows only the game itself to run code', () => {
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect([...csp.values()].flat()).not.toContain("'unsafe-eval'");
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
  });

  it('lets the game load its images, audio and data, and reach monde-mind', () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(csp.get('media-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(csp.get('connect-src')).toEqual(["'self'", 'data:', 'blob:', 'https://monde-mind-staging.fly.dev']);
  });

  it('allows no server when the build config is missing', () => {
    expect(directives(buildCsp([])).get('connect-src')).toEqual(["'self'", 'data:', 'blob:']);
  });
});

describe('navigation', () => {
  it('knows the game URLs', () => {
    expect(isAppUrl('app://monde/index.html')).toBe(true);
    expect(isAppUrl('app://monde/')).toBe(true);
    expect(isAppUrl('app://evil/index.html')).toBe(false);
    expect(isAppUrl('https://monde/')).toBe(false);
    expect(isAppUrl('file:///etc/passwd')).toBe(false);
    expect(isGameUrl('http://localhost:5173/src/main.ts', 'http://localhost:5173')).toBe(true);
    expect(isGameUrl('http://localhost:5173/', null)).toBe(false);
    expect(isGameUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
  });

  it('opens only web and mail links externally', () => {
    expect(externalUrl('https://itch.io/')).toBe('https://itch.io/');
    expect(externalUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    for (const url of ['file:///Applications/Calculator.app', 'app://monde/', 'javascript:alert(1)', 'smb://share/x', 'not a url']) {
      expect(externalUrl(url), url).toBeNull();
    }
  });

  it('passes only an invite code and Offline to the game', () => {
    expect(entryQuery(['/Applications/Monde.app/Contents/MacOS/Monde'])).toBe('');
    expect(entryQuery(['monde', '--invite=SPRING-24'])).toBe('?invite=SPRING-24');
    expect(entryQuery(['monde', '--offline'])).toBe('?offline');
    expect(entryQuery(['monde', '--invite=a b', '--invite=../x', '--skiptitle=1'])).toBe('');
  });
});

describe('build config', () => {
  it('reads the server origin and refuses insecure ones', () => {
    expect(mindOrigin('https://monde-mind-staging.fly.dev/')).toBe('https://monde-mind-staging.fly.dev');
    expect(mindOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    expect(mindOrigin('http://monde-mind.fly.dev')).toBeNull();
    expect(mindOrigin('nonsense')).toBeNull();
    const dir = mkdtempSync(path.join(tmpdir(), 'monde-config-'));
    writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ mindUrl: 'https://monde-mind-staging.fly.dev' }));
    writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ mindUrl: 'ftp://x' }));
    expect(readBuildConfig(path.join(dir, 'ok.json'))).toEqual({ mindUrl: 'https://monde-mind-staging.fly.dev' });
    expect(readBuildConfig(path.join(dir, 'bad.json'))).toBeNull();
    expect(readBuildConfig(path.join(dir, 'missing.json'))).toBeNull();
  });
});
