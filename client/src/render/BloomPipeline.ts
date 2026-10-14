import Phaser from "phaser";

// A real bloom for the battle camera: only the bright parts glow, the glow
// is ADDED on top, and the frame's own alpha passes through untouched.
//
// This replaces Phaser's built-in Bloom FX, which is not a bloom in that
// sense. Its final step is `mix(original, blurred * strength, 0.5)` — a
// 50/50 blend of the frame with a dimmed, blurred copy of itself (and each
// of its blur passes loses ~4% because the tap weights sum to 0.96). For an
// opaque board that works out to alpha ≈ 0.75 and colour at ~75%, softened
// by half a blur. Drawn over black, as battles always were, that read as
// every battle being a quarter darker and noticeably blurrier than its art
// — the murk in every baseline capture. Drawn over the ¾ board's backdrop
// scene, it made the board see-through.
//
// One pass, one shader. A first version chained bright-pass → blur →
// combine through Phaser's intermediate targets and switched programs
// mid-pipeline; the attribute bindings didn't survive the switch and the
// screen came out as a grey smear split along the quad's diagonal. Two
// rings of thresholded taps in a single fragment shader give a soft,
// highlight-only glow with nothing to go out of sync, and make the alpha
// guarantee structural: the output alpha IS the input alpha.

const FRAG = `
#define SHADER_NAME RAVAGE_BLOOM_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uStrength;
uniform float uRadius;
varying vec2 outTexCoord;

// What glows: bright AND coloured. Flames, the Ravage aura, crit gold,
// lens light and sunlit glints are all strongly saturated; the brightest
// GROUND in the game — marble (mean luminance 0.86) and snow (0.91) — is
// near-white. Keyed on luminance alone, a marble causeway bloomed as one
// blown-out slab. Unsaturated surfaces keep a faint sheen (0.3), so a
// white-hot flame core still glows.
vec3 bright (vec2 uv) {
  vec3 c = texture2D(uMainSampler, uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float hi = max(c.r, max(c.g, c.b));
  float sat = hi > 0.0 ? (hi - min(c.r, min(c.g, c.b))) / hi : 0.0;
  return c * smoothstep(uThreshold, uThreshold + 0.16, l) * (0.3 + 0.7 * smoothstep(0.18, 0.5, sat));
}

void main () {
  vec4 base = texture2D(uMainSampler, outTexCoord);
  vec2 r1 = uTexel * uRadius;
  vec2 r2 = r1 * 2.3;
  vec3 glow = bright(outTexCoord) * 0.16;
  // Eight directions, two rings. Weights sum to 1 (0.16 + 8·0.075 + 8·0.03).
  glow += (bright(outTexCoord + vec2( 1.0,  0.0) * r1) + bright(outTexCoord + vec2(-1.0,  0.0) * r1)
         + bright(outTexCoord + vec2( 0.0,  1.0) * r1) + bright(outTexCoord + vec2( 0.0, -1.0) * r1)
         + bright(outTexCoord + vec2( 0.707,  0.707) * r1) + bright(outTexCoord + vec2(-0.707,  0.707) * r1)
         + bright(outTexCoord + vec2( 0.707, -0.707) * r1) + bright(outTexCoord + vec2(-0.707, -0.707) * r1)) * 0.075;
  glow += (bright(outTexCoord + vec2( 1.0,  0.0) * r2) + bright(outTexCoord + vec2(-1.0,  0.0) * r2)
         + bright(outTexCoord + vec2( 0.0,  1.0) * r2) + bright(outTexCoord + vec2( 0.0, -1.0) * r2)
         + bright(outTexCoord + vec2( 0.707,  0.707) * r2) + bright(outTexCoord + vec2(-0.707,  0.707) * r2)
         + bright(outTexCoord + vec2( 0.707, -0.707) * r2) + bright(outTexCoord + vec2(-0.707, -0.707) * r2)) * 0.03;
  // Additive on premultiplied colour. Over the board (alpha 1) the glow
  // only ever brightens and alpha stays 1. Over empty sky (alpha 0) the
  // halo gets just enough alpha to carry it — the brightest channel, which
  // keeps the colour validly premultiplied. Left at alpha 0, the colour
  // grade after us (which un-premultiplies) zeroed it, and a back-row
  // torch's glow stopped dead at the board's silhouette.
  vec3 g = glow * uStrength;
  gl_FragColor = vec4(base.rgb + g, max(base.a, min(1.0, max(g.r, max(g.g, g.b)))));
}
`;

export const BLOOM_PIPELINE = "RavageBloom";

export class BloomPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** Luminance (0-1) where glow starts (see `bright` for the colour key). */
  threshold = 0.78;
  /** How much of the glow is added back. */
  strength = 0.5;
  /** Inner ring radius in buffer pixels (outer ring is 2.3×). */
  radius = 5;

  constructor(game: Phaser.Game) {
    super({ game, name: BLOOM_PIPELINE, fragShader: FRAG });
  }

  onPreRender(): void {
    this.set2f("uTexel", 1 / this.renderer.width, 1 / this.renderer.height);
    this.set1f("uThreshold", this.threshold);
    this.set1f("uStrength", this.strength);
    this.set1f("uRadius", this.radius);
  }
}
