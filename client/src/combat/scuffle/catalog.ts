export const SCUFFLES = {
  sc_bakery_tutorial: { name: 'Flour on the floor', zone: 'market_row', place: 'bakery', enemies: ['bru', 'nettie'],
    opening: 'Odile: Mind the starter. It has survived worse manners than yours.',
    ending: 'Bru brushes flour from his sleeve. Odile puts the kettle on.' },
  sc_market_saturday: { name: 'Twenty coins too many', zone: 'market_row', place: 'market_street', enemies: ['dex', 'dom', 'weasel'],
    opening: 'Nell: Twenty coins for standing there? I can stand there myself.',
    ending: 'The stallholders put their price cards back. Business resumes.' },
  sc_bins_raccoons: { name: 'The midnight buffet', zone: 'old_quarter', place: 'back_alley', enemies: ['raccoon_1', 'raccoon_2', 'raccoon_3'],
    opening: 'A bin lid rises. Three masked faces consider your qualifications.',
    ending: 'The last raccoon leaves with considerable dignity. The lid stays shut.' }
} as const;
export type ScuffleId = keyof typeof SCUFFLES;
export const isScuffleId = (id: string): id is ScuffleId => Object.hasOwn(SCUFFLES, id);
export const TUTORIAL = [
  'Odile: You have my umbrella. Umbrella beats pan, pan beats broom, broom beats umbrella. Brace halves damage while your umbrella counters Bru. Tool buttons appear after you begin; switching costs one AP.',
  'Odile: Blue tiles are a Move. Go around the counter. Get close, but keep one AP for Brace; it halves damage while your umbrella counters Bru. Ready and Brace can be held together.',
  'Odile: There is another way. Beside someone, Talk Down costs two AP. Heart helps; their Nerve resists. Try words when you have two AP. Startled? Swing or Brace until you can.',
  'Nettie: I only ping the floor! (Get beside Nettie so she cannot Ping you. Swing or Talk Down; with an ally, two adjacent opponents make her leave.)',
  'Odile: Bread helps. So does knowing when to leave. Step to the edge and Run. We’ll still have tea.'
] as const;
