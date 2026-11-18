import { Component, computed, input } from '@angular/core';
import { DealtCard, Fac, PassTarget, PENALTY_NAMES, PenaltyAgainst, RunDirective, SolitaireDefense } from '../../engine';
import { Tooltip } from '../../shared/tooltip';

const PASS_TARGET: Record<PassTarget, string> = { ORIG: 'Orig', PASS_RUSH: 'P. Rush', FL: 'FL', LE: 'LE', RE: 'RE', BK1: 'BK 1', BK2: 'BK 2' };
const AGAINST: Record<PenaltyAgainst, string> = { O: 'the offense', D: 'the defense', K: 'the kicking team', R: 'the receiving team' };
const CATEGORY = ['runs, quick and screen passes', 'short and long passes', 'field goals, punts and their returns', 'kickoffs and their returns'];
const SOLITAIRE: Record<SolitaireDefense, string> = {
  RUN_NO_KEY: 'Run, no key', RUN_KEY_BC: 'Run, key BC', PASS: 'Pass', PASS_DOUBLE: 'Pass, double', PREVENT: 'Prevent',
  PREVENT_DOUBLE: 'Prevent, double', BLITZ: 'Blitz',
};
const DEFENSIVE_BOXES = 'ABCDEFGHIJKLMNO';

function runText(d: RunDirective): string {
  switch (d.kind) {
    case 'blockers': return d.players.join(' + ');
    case 'boxes': return d.boxes.join(' + ');
    case 'matchup': return `${d.blocker} vs ${d.box}`;
    case 'break': return 'Break';
  }
}

/**
 * One Fast Action Card (rule 5.0), drawn the way the printed card reads: the run and pass numbers, the running and
 * passing lines, the Z line and the solitaire defenses. A Z card shows a big Z and whether it counted. Every card has
 * the size of a player card: the parent sets the height (see PlayCards), and the sections spread down the card.
 */
@Component({
  selector: 'spf-fac-card',
  imports: [Tooltip],
  template: `
    @let c = card();
    <article [class.z-card]="c.isZ">
      <header>
        <span>Fast Action Card</span>
        <span>{{ label() }}</span>
      </header>
      @if (c.isZ) {
        <p class="big-z" aria-label="Z card">Z</p>
        @if (dealt()?.z === 'counts') {
          <p class="z-note"><strong>Counts.</strong> Once the play is over, a later card's Z line gives the result.</p>
        } @else {
          <p class="z-note"><strong>Does not count</strong> on this play (rule 8.8.1); the next card takes its place.</p>
        }
      } @else {
        <div class="numbers">
          <div><span>Run number</span><b>{{ c.runNumber }}</b>@if (c.outOfBounds) { <i spfTip="Out of bounds: the play ends out of bounds when this RN is the last one used (rule 9.1)">OB</i> }</div>
          <div><span>Pass number</span><b>{{ c.passNumber }}</b></div>
        </div>
        <section>
          <h3>Running plays</h3>
          <dl class="pairs">
            <dt>SL</dt><dd>{{ runs().SL }}</dd><dt>SR</dt><dd>{{ runs().SR }}</dd>
            <dt>IL</dt><dd>{{ runs().IL }}</dd><dt>IR</dt><dd>{{ runs().IR }}</dd>
            <dt>ER</dt><dd>{{ c.endAround }}</dd>
          </dl>
        </section>
        <section>
          <h3>Passing plays</h3>
          <dl class="threes">
            <dt>QK</dt><dd>{{ passTarget(c.passes.QK) }}</dd>
            <dt>SH</dt><dd>{{ passTarget(c.passes.SH) }}</dd>
            <dt>LG</dt><dd>{{ passTarget(c.passes.LG) }}</dd>
          </dl>
          <dl class="threes"><dt>SC</dt><dd class="wide">{{ screen() }}</dd></dl>
        </section>
        <section class="z" [class.read]="dealt()?.z === 'result'">
          <h3>Z @if (dealt()?.z === 'result') { <em>the result of this play's Z card</em> }</h3>
          @switch (c.z.type) {
            @case ('INJURY') { <p [spfTip]="injuryTip()">Injury: {{ c.z.target }}</p> }
            @case ('FUMBLE') {
              <p [spfTip]="c.z.homeTeamExempt ? 'Fumble(s): no fumble when the ball carrier is on the home team (rule 8.8.5)' : ''">
                {{ c.z.homeTeamExempt ? 'Fumble(s)' : 'Fumble' }}</p>
            }
            @case ('PENALTY') {
              <ol class="penalties">
                @for (p of c.z.byCategory; track $index) {
                  <li [spfTip]="penaltyTip($index, p.against, p.penalty)"><span>{{ $index + 1 }}</span> {{ p.against }} {{ p.penalty }}</li>
                }
              </ol>
            }
          }
        </section>
        <section>
          <h3>Solitaire</h3>
          <ol class="solitaire">
            @for (s of c.solitaire; track $index) { <li><span>{{ $index + 1 }}</span> {{ solitaire(s) }}</li> }
          </ol>
        </section>
      }
    </article>
  `,
  styles: `
    :host { display: block; }
    /* The parent may set --fac-ink and --fac-soft (lighter for cards out of focus). */
    article {
      height: 100%; box-sizing: border-box; display: flex; flex-direction: column; background: var(--spf-paper);
      border-radius: var(--radius-panel); padding: .9rem 1rem 1rem; color: var(--fac-ink, var(--spf-ink)); transition: color .15s;
    }
    header { display: flex; justify-content: space-between; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--fac-soft, var(--spf-ink-soft)); }
    /* The sections spread down the card, like the player cards: the free space goes before each one and after the last. */
    article > .numbers, article > section, article > .big-z, article > .z-note { margin-top: auto; }
    article::after { content: ''; margin-top: auto; }
    .numbers { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
    .numbers div { position: relative; display: grid; justify-items: center; padding: .3rem 0 .2rem; border: 1.5px solid currentColor; border-radius: 6px; }
    .numbers span { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--fac-soft, var(--spf-ink-soft)); }
    .numbers b { font-size: 2rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .numbers i { position: absolute; right: .35rem; bottom: .3rem; font-style: normal; font-size: .72rem; font-weight: 700; }
    h3 { margin: 0 0 .2rem; font-size: 1rem; }
    h3 em { font-style: normal; font-weight: 600; font-size: .75rem; margin-left: .3rem; }
    dl { margin: 0; display: grid; font-size: .88rem; row-gap: .1rem; column-gap: .35rem; font-variant-numeric: tabular-nums; }
    dt { color: var(--fac-soft, var(--spf-ink-soft)); font-weight: 600; }
    dd { margin: 0; }
    .pairs { grid-template-columns: 1.8rem 1fr 1.8rem 1fr; }
    .threes { grid-template-columns: 1.8rem 1fr 1.8rem 1fr 1.8rem 1fr; }
    .threes + .threes { margin-top: .1rem; }
    .threes .wide { grid-column: span 5; }
    p { margin: 0; font-size: .9rem; }
    ol { list-style: none; margin: 0; padding: 0; display: grid; font-size: .85rem; row-gap: .1rem; }
    ol li span { display: inline-block; min-width: 1rem; font-weight: 700; color: var(--fac-soft, var(--spf-ink-soft)); }
    .penalties { grid-template-columns: repeat(4, 1fr); font-variant-numeric: tabular-nums; }
    .solitaire { grid-template-columns: 1fr 1fr; column-gap: .5rem; }
    /* The card whose Z line was read for this play's Z card. */
    .z.read { margin-left: -.5rem; margin-right: -.5rem; padding: .3rem .5rem .35rem; border-radius: 6px; background: var(--fac-mark, #fff3c4); }
    .big-z { text-align: center; font-size: 9rem; font-weight: 800; line-height: 1; letter-spacing: -.02em; }
    .z-note { text-align: center; font-size: .9rem; line-height: 1.4; padding: 0 .3rem; }
  `,
})
export class FacCardView {
  readonly card = input.required<Fac>();
  /** How the card was dealt: a Z card that counted or not, or the card whose Z line was read. */
  readonly dealt = input<DealtCard | null>(null);
  /** "Card 2 of 3", top right. */
  readonly label = input('');

  protected readonly runs = computed(() => {
    const c = this.card();
    return c.isZ ? { SL: '', SR: '', IL: '', IR: '' } : { SL: runText(c.runs.SL), SR: runText(c.runs.SR), IL: runText(c.runs.IL), IR: runText(c.runs.IR) };
  });
  protected readonly screen = computed(() => {
    const c = this.card();
    if (c.isZ) return '';
    const s = c.screen;
    if (s.result !== 'COM') return s.result === 'INC' ? 'Inc' : 'Int';
    return `Com × ${s.multiplier === 0.5 ? '½' : s.multiplier}`;
  });
  protected readonly injuryTip = computed(() => {
    const c = this.card();
    if (c.isZ || c.z.type !== 'INJURY') return '';
    const t = c.z.target;
    const who = t === 'BC' ? 'the ball carrier' : DEFENSIVE_BOXES.includes(t) ? `the defender in box ${t}` : `the player at ${t}`;
    return `Injury to ${who}; the next card's pass number says for how long (rule 8.8.4)`;
  });

  protected passTarget(t: PassTarget) {
    return PASS_TARGET[t];
  }
  protected solitaire(s: SolitaireDefense) {
    return SOLITAIRE[s];
  }
  protected penaltyTip(category: number, against: PenaltyAgainst, penalty: number) {
    return `Category ${category + 1} (${CATEGORY[category]}): ${PENALTY_NAMES[penalty] ?? `penalty ${penalty}`} on ${AGAINST[against]}`;
  }
}
