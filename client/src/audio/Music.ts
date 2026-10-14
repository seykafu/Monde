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
