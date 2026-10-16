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
  'Odile: Pan beats broom, broom beats umbrella, umbrella beats pan. Choose an umbrella against Bru’s pan; an advantaged defender counters.',
  'Odile: Blue tiles are a Move. Get close, but keep one AP for Brace or Ready. You can hold both.',
  'Odile: There is another way. Beside someone, Talk Down costs two AP. Heart helps; their Nerve resists. Next turn, try words.',
  'Nettie: I only ping the floor. Give me room and I’ll go. (Two neighbours make Nettie leave.)',
  'Odile: Bread helps. So does knowing when to leave. Step to the edge and Run. We’ll still have tea.'
] as const;
