import Phaser from "phaser";

// Placeholder boot scene; replaced by the real scene graph in the Foundation phase (MVP_PLAN F-02..F-04).
class HelloScene extends Phaser.Scene {
  constructor() {
    super("Hello");
  }
  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Monde", { fontFamily: "Georgia, serif", fontSize: "48px", color: "#f3e3c3" })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#14110f",
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [HelloScene]
});
