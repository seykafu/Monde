import { IDLE_POSES, type Pose } from './rig';
/** §16.5: procedural tool swing (impact frame 3), recoil and seated/winded fallback. */
const rest = IDLE_POSES[0]!;
export const SCUFFLE_POSES: Record<'swing' | 'hit' | 'winded', readonly Pose[]> = {
  swing: [-1, -2, 2, 1, 0].map((arm, i) => ({ ...rest, arm: [arm, -arm], ub: i === 2 ? -1 : 0, sway: arm })),
  hit: [{ ...rest, ub: 1, arm: [-1, 1], blink: true }, { ...rest, ub: 2, breath: 1 }],
  winded: [1, 2, 3, 4].map(ub => ({ ...rest, ub, fwd: [3, 3], arm: [1, 1], blink: true }))
};
