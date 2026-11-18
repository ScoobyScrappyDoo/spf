/**
 * Plain-English descriptions of the formations, for their tooltips:
 * "Pass orientated: 3 WR with a TE to the left", "Balanced: 3 linemen in A, C and E, 4 linebackers in F, G, I and J, 4 backs".
 */
import { DefenseFormation, OffenseFormation } from '../engine';

const and = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** By the number of backs: one is pass orientated, two balanced, three run orientated. */
export function offenseFormationText(f: OffenseFormation): string {
  const slots = f.skillSlots;
  const backs = slots.filter(s => s.startsWith('RB')).length;
  const tightEnds = slots.filter(s => s === 'TEL' || s === 'TER');
  const flankers = slots.filter(s => s === 'FLL' || s === 'FLR');
  const splitEnds = slots.filter(s => s === 'SEL' || s === 'SER');
  const receivers = flankers.length + splitEnds.length;
  const prefix = backs === 1 ? 'Pass orientated' : backs === 2 ? 'Balanced' : 'Run orientated';

  const items: string[] = [];
  if (backs > 1) items.push(`${backs} RB`);
  if (receivers === 1) items.push(flankers.length ? `a flanker on the ${flankers[0] === 'FLL' ? 'left' : 'right'}` : 'a split end');
  else if (receivers > 1) items.push(`${receivers} WR`);
  if (tightEnds.length === 2) items.push('two TEs');
  let text = and(items);
  if (tightEnds.length === 1) text += ` with a TE to the ${tightEnds[0] === 'TEL' ? 'left' : 'right'}`;
  return `${prefix}: ${text}`;
}

/** Five linemen and four backs is run orientated, five or six backs pass orientated, the rest balanced. */
export function defenseFormationText(f: DefenseFormation): string {
  const line = f.slots.filter(s => s.role === 'DE' || s.role === 'DT');
  const backers = f.slots.filter(s => s.role === 'LB');
  const backs = f.slots.filter(s => s.role === 'CB' || s.role === 'S' || s.role === 'DB');
  const inL = backs.filter(s => s.box === 'L').length;
  const prefix = backs.length >= 5 ? 'Pass orientated' : line.length === 5 ? 'Run orientated' : 'Balanced';
  const boxes = (slots: { box: string }[]) => and(slots.map(s => s.box));
  const lb = backers.length === 1 ? `1 linebacker in ${boxes(backers)}` : `${backers.length} linebackers in ${boxes(backers)}`;
  const l = inL === 2 ? ' (two of them in box L)' : inL === 1 ? ' (one in box L)' : '';
  return `${prefix}: ${line.length} linemen in ${boxes(line)}, ${lb}, ${backs.length} backs${l}`;
}
