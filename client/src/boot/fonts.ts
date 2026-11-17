const faces = [
  ['EB Garamond', 'eb-garamond-var', '400 700', 'normal'],
  ['EB Garamond', 'eb-garamond-italic-var', '400 700', 'italic'],
  ['Inter', 'inter-var', '400 700', 'normal'],
  ['Caveat', 'caveat-var', '400 700', 'normal'],
  ['Old Standard TT', 'old-standard-tt-400', '400', 'normal'],
  ['Old Standard TT', 'old-standard-tt-700', '700', 'normal'],
  ['Old Standard TT', 'old-standard-tt-400-italic', '400', 'italic']
] as const;

export function fontFaces(base: string) {
  return faces.map(([family, file, weight, style]) => ({
    family, source: `url(${base}assets/fonts/${file}.woff2)`, weight, style
  }));
}

export async function loadFonts(timeoutMs = 2000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(fontFaces(import.meta.env.BASE_URL).map(async ({ family, source, weight, style }) => {
        const face = new FontFace(family, source, { weight, style });
        document.fonts.add(face);
        await face.load();
      })),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
