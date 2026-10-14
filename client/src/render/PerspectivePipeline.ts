import Phaser from "phaser";

// Camera-level perspective for the ¾ battle board — see render/keystone.ts
// for the model and the tested math. This shader is keystone.screenToSource
// transcribed into GLSL; keep the two in lockstep.
//
// Pixels the tilt reveals beyond the camera image are written fully
// transparent rather than edge-clamped (which would smear the border column
// into streaks). The battle's backdrop lives in its own scene rendered
// underneath (BattleBackdropScene), so those pixels show painted sky.

const FRAG = `
#define SHADER_NAME RAVAGE_PERSPECTIVE_FS
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform float uK;
uniform float uCenterX;

varying vec2 outTexCoord;

void main () {
  // outTexCoord.y runs from 0 at the bottom of the frame.
  float t = outTexCoord.y;
  float w = 1.0 - uK * t;
  float us = uCenterX + (outTexCoord.x - uCenterX) / w;
  float s = uK > 0.0 ? -log(1.0 - uK * t) / uK : t;
  if (us < 0.0 || us > 1.0 || s < 0.0 || s > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = texture2D(uMainSampler, vec2(us, s));
}
`;

export const PERSPECTIVE_PIPELINE = "RavagePerspective";

export class PerspectivePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** Tilt strength; the top of the screen is scaled by (1 − k). */
  k = 0;
  /** Optical axis as a fraction of the frame width. */
  centerX = 0.5;

  constructor(game: Phaser.Game) {
    super({ game, name: PERSPECTIVE_PIPELINE, fragShader: FRAG });
  }

  onPreRender(): void {
    this.set1f("uK", this.k);
    this.set1f("uCenterX", this.centerX);
  }
}

