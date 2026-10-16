// Who lives where, from the persona cards (§9.3 `home`): the directory town/occupancy.ts reads for the boards.
import { directoryFromCards, type HomeDirectory } from '../town/occupancy';
import { personaCards } from './residents';

export const homeDirectory: HomeDirectory = directoryFromCards(personaCards);
