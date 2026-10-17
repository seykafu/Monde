// A stand-in for Phaser under vitest (Node has no canvas): every property and call is another stand-in, so modules that
// declare Phaser scenes and read Phaser constants at import time load, and the bot never draws anything.
const deep = (): unknown => new Proxy(function stub() { /* nothing */ }, {
  get: (_t, k) => (k === 'prototype' ? {} : k === Symbol.toPrimitive ? () => 0 : deep()),
  construct: () => deep() as object,
  apply: () => deep()
});
export default deep();
