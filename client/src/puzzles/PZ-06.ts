import { puzzle, vector, indices } from './core';
export const suspects = ['Tib','Bertrand','June','Moss'];
export const statements = ['Tib: Wasn’t me. I fed them peas.', 'Bertrand: June did it. I saw her.', 'June: Bertrand’s lying.', 'Old Moss: It was the boy or the old man.'];
export const truths = (culprit: number) => [culprit!==0, culprit===2, culprit!==2, culprit===0 || culprit===1];
export const PZ06 = puzzle({ id: 'PZ-06', title: 'Who Fed the Ducks?', instructions: 'Exactly one person is fibbing. Who fed the ducks stale bread? Choose a suspect, then check their account.',
  hints: ['Try each suspect as the culprit and count the false statements.', 'June’s and Bertrand’s statements can’t both be true.', 'Try Bertrand.'],
  initial: [-1], valid: c => vector(c,1,-1,3), legal: () => indices(4), move: (_c,i) => [i], won: c => c[0]! >= 0 && truths(c[0]!).filter(v=>!v).length===1 });
export const { reset, legalMoves, move, undo, win, hint, serialize, restore } = PZ06;
