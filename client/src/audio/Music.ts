import type Phaser from 'phaser';
import { MusicManager } from './MusicManager';
export { MusicManager };
export { MUSIC, MUSIC_FILES, type MusicKey } from './musicKeys';
export function getMusic(scene: Phaser.Scene): MusicManager {
  let manager = scene.game.registry.get('monde:music') as MusicManager | undefined;
  if (!manager) {
    manager = new MusicManager();
    scene.game.registry.set('monde:music', manager);
    const owned = manager;
    scene.game.events.once('destroy', () => owned.dispose());
  }
  return manager;
}

/**
 * A scene that plays its own cue (a story scene, a Scuffle, a festival) holds the music so the town doesn't
 * talk over it; releasing hands it back, and the town picks its track again on its next tick.
 */
export function holdMusic(scene: Phaser.Scene, owner: string): void {
  const holds = new Set(scene.game.registry.get('monde:musicHolds') as string[] | undefined);
  holds.add(owner);
  getMusic(scene).holdAmbience(true);
  scene.game.registry.set('monde:musicHolds', [...holds]);
}
export function releaseMusic(scene: Phaser.Scene, owner: string): void {
  const holds = new Set(scene.game.registry.get('monde:musicHolds') as string[] | undefined);
  holds.delete(owner);
  getMusic(scene).holdAmbience(holds.size > 0);
  if (holds.size === 0) {
    // The zone may have been asleep during the hold. Consume elapsed bell times rather than replaying them
    // after a story's own chime (especially S07a/S07b).
    const clock = scene.registry.get('monde.clock') as { day: number; exactMinute: number } | undefined;
    if (clock) scene.registry.set('monde:chimeTime', { day: clock.day, minute: clock.exactMinute });
  }
  scene.game.registry.set('monde:musicHolds', [...holds]);
}
export const musicHeld = (scene: Phaser.Scene): boolean =>
  ((scene.game.registry.get('monde:musicHolds') as string[] | undefined)?.length ?? 0) > 0;
