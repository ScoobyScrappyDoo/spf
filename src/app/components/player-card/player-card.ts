import { Component, computed, input } from '@angular/core';
import { Crutches } from '../crutches/crutches';
import { formatRange, GainCell, Injury, injuryText, PassingRanges, PlayerCard, Position } from '../../engine';

const POSITION_NAMES: Record<Position, string> = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', OT: 'Tackle', OG: 'Guard', C: 'Center',
  DE: 'Defensive End', DT: 'Defensive Tackle', LB: 'Linebacker', DB: 'Defensive Back', K: 'Place-Kicker', P: 'Punter',
};

/** Writes a row the way the printed card does: "Sg/28/73", "6/16", "Lg/Lg/76". Trailing blanks are dropped. */
function row(cells: GainCell[]): string {
  const text = cells.map(c => (c === 'SG' ? 'Sg' : c === 'LG' ? 'Lg' : c === 'INC' ? 'inc' : c === 'TD' ? 'TD' : c === null ? '' : String(c)));
  while (text.length && text.at(-1) === '') text.pop();
  return text.join('/');
}

const signed = (n: number) => (n > 0 ? `Plus ${n}` : n < 0 ? `Minus ${-n}` : 'Plus 0');

@Component({
  selector: 'spf-player-card',
  imports: [Crutches],
  template: `
    @let p = player();
    <article [class.line-card]="lineCard()" [class.compact]="p.position === 'LB' || p.position === 'DB'" [class.has-oop]="!!outOfPosition()">
      <p class="team">{{ teamName() }}</p>
      <p class="pos">{{ subtitle() }}</p>
      <h2>{{ p.firstName }} {{ p.lastName }}</h2>
      @if (injury(); as i) {
        <p class="injured"><spf-crutches [size]="16" /> Injured: out for {{ injuryText(i.length) }}</p>
      }

      @switch (p.position) {
        @case ('QB') {
          <p class="pos">Endurance {{ p.endurance }}</p>
          <div class="cols">
            <section>
              <h3>Passing</h3>
              @for (t of passing(); track t.label) {
                <h4>{{ t.label }}</h4>
                <dl>
                  <dt>Com</dt><dd>{{ fmt(t.r.com) }}</dd>
                  <dt>Inc</dt><dd>{{ fmt(t.r.inc) }}</dd>
                  <dt>Int</dt><dd>{{ fmt(t.r.int) }}</dd>
                </dl>
              }
            </section>
            <section>
              <h3>Rushing</h3>
              <ol>@for (r of p.rushing; track $index) { <li><b>{{ $index + 1 }}:</b> {{ row([r.n, r.sg, r.lg]) }}</li> }</ol>
            </section>
          </div>
          <section>
            <h3>Pass rush</h3>
            <dl>
              <dt>Sack</dt><dd>{{ fmt(p.passRush.sack) }}</dd>
              <dt>Runs</dt><dd>{{ fmt(p.passRush.runs) }}</dd>
              <dt>Com</dt><dd>{{ fmt(p.passRush.com) }}</dd>
              <dt>Inc</dt><dd>{{ fmt(p.passRush.inc) }}</dd>
            </dl>
          </section>
        }
      }

      @if (p.position === 'RB' || p.position === 'WR' || p.position === 'TE') {
        <div class="cols">
          <section>
            <h3>Rushing</h3>
            <h4>N/SG/LG</h4>
            <ol>@for (i of twelve; track i) { <li><b>{{ i + 1 }}:</b> {{ p.rushing ? row([p.rushing[i].n, p.rushing[i].sg, p.rushing[i].lg]) : '' }}</li> }</ol>
          </section>
          <section>
            <h3>Pass gain</h3>
            <h4>Q/S/L</h4>
            <ol>@for (i of twelve; track i) { <li><b>{{ i + 1 }}:</b> {{ p.passGain ? row([p.passGain[i].q, p.passGain[i].s, p.passGain[i].l]) : '' }}</li> }</ol>
          </section>
        </div>
        <section><h3>Blocks</h3><p>{{ signed(p.blocks) }}</p></section>
      }

      <!-- Linemen, linebackers and backs: laid out like the printed cards, one value under each heading. -->
      @if (p.position === 'OT' || p.position === 'OG' || p.position === 'C') {
        <!-- Out of position (rule O1): the printed value crossed out, beside what counts where he plays. -->
        <section class="stat"><h3>Blocks:</h3>
          @if (outOfPosition()) { <p><s class="printed">{{ signed(p.runBlock) }}</s> <b class="counts">{{ signed(p.runBlock - 1) }}</b></p> }
          @else { <p>{{ signed(p.runBlock) }}</p> }
        </section>
        <section class="stat"><h3>Pass block:</h3>
          @if (outOfPosition()) { <p><s class="printed">{{ p.passBlock }}</s> <b class="counts">{{ p.passBlock - 1 }}</b></p> }
          @else { <p>{{ p.passBlock }}</p> }
        </section>
      }
      @if (p.position === 'DE' || p.position === 'DT' || p.position === 'LB') {
        <section class="stat"><h3>Tackles:</h3><p>{{ signed(p.tackle) }}</p></section>
      }
      @if (p.position === 'DE' || p.position === 'DT') {
        <section class="stat"><h3>Pass rush:</h3><p>{{ p.passRush }}</p></section>
      }
      @if (p.position === 'LB') {
        <section class="stat"><h3>Pass rush:</h3><p>{{ p.passRush }}</p></section>
        <section class="stat"><h3>Pass def:</h3><p>{{ signed(p.passDefense) }}</p></section>
        <section class="stat"><h3>Intercepts:</h3><p>{{ (fmt(p.intercept) || 'None') + (p.interceptMaybe ? '?' : '') }}</p></section>
      }
      @if (p.position === 'DB') {
        <section class="stat"><h3>Pass def:</h3>
          @if (outOfPosition()) { <p><s class="printed">{{ signed(p.passDefense) }}</s> <b class="counts">{{ signed(p.passDefense + 1) }}</b></p> }
          @else { <p>{{ signed(p.passDefense) }}</p> }
        </section>
        <section class="stat"><h3>Pass rush:</h3><p>{{ p.passRush }}</p></section>
        <section class="stat"><h3>Intercepts:</h3><p>{{ (fmt(p.intercept) || 'None') + (p.interceptMaybe ? '?' : '') }}</p></section>
      }
      @if (p.position === 'K') {
        <section class="kick">
          <h3>Field goals</h3>
          <table class="mini">
            <thead><tr><th>Distance</th><th>Good</th></tr></thead>
            <tbody>
              @for (band of p.fieldGoals; track $index) { <tr><td>{{ band.minYards }}-{{ band.maxYards }} yds</td><td>{{ fmt(band.good) || '–' }}</td></tr> }
            </tbody>
          </table>
          <h3>Extra points</h3>
          <p>Good: {{ fmt(p.extraPoint) || '–' }}</p>
        </section>
      }
      @if (p.position === 'P') {
        <section class="kick">
          <h3>Punting</h3>
          <table class="mini">
            <thead><tr><th>RN</th><th>Yards</th><th>Return</th></tr></thead>
            <tbody>
              @for (punt of p.punts.slice(0, 11); track $index) {
                <tr><td>{{ $index + 1 }}</td><td>{{ punt.yards }}</td><td>{{ punt.returner === 'FC' ? 'Fair catch' : punt.returner }}</td></tr>
              }
              <tr><td>12</td><td colspan="2">Special: a new card</td></tr>
            </tbody>
          </table>
          <h3>RN 12</h3>
          @for (s of p.special; track $index) {
            <p class="special">{{ fmt(s.runNumber) }}: {{ s.result.type === 'NO_RETURN' ? s.result.yards + ' yards, no return' : s.result.type === 'BLOCKED' ? 'blocked' : 'penalty' }}</p>
          }
        </section>
      }
      @if (outOfPosition(); as o) {
        <aside class="oop" role="note">
          <strong>Out of position</strong>
          <span>{{ o }}: {{ p.position === 'DB' ? 'pass defense one worse' : '−1 to run and pass block' }}</span>
        </aside>
      }
    </article>
  `,
  styles: `
    :host { display: block; }
    article { position: relative; height: 100%; background: var(--spf-paper); border-radius: var(--radius-panel); padding: .9rem 1rem 1rem; color: var(--spf-ink); }
    .team { margin: 0; text-align: center; font-weight: 700; font-size: 1.05rem; }
    .pos { margin: .1rem 0; text-align: center; color: var(--spf-ink-soft); }
    h2 { margin: .25rem 0 .2rem; text-align: center; font-size: 1.45rem; font-weight: 700; }
    .injured { display: flex; justify-content: center; align-items: center; gap: .3rem; color: #7a2e0e; font-weight: 600; margin: .1rem 0 .3rem; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-top: .6rem; }
    h3 { margin: .5rem 0 .15rem; font-size: 1rem; }
    h4 { margin: .25rem 0 .05rem; font-size: .82rem; }
    dl { display: grid; grid-template-columns: 2.6rem 1fr; margin: 0; font-size: .85rem; row-gap: .05rem; }
    dt { color: var(--spf-ink-soft); }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    ol { list-style: none; margin: 0; padding: 0; font-size: .85rem; line-height: 1.35; font-variant-numeric: tabular-nums; }
    ol b { display: inline-block; min-width: 1.8rem; }
    p { margin: 0; font-size: .9rem; }

    /* Kickers and punters: small tables, as on the printed cards. */
    .kick h3 { margin: .7rem 0 .25rem; font-size: 1rem; }
    .kick p { margin: .1rem 0; font-variant-numeric: tabular-nums; }
    .mini { border-collapse: collapse; font-size: .9rem; font-variant-numeric: tabular-nums; }
    .mini th { text-align: left; font-weight: 600; padding: .05rem .9rem .1rem 0; border-bottom: 1px solid #d1d5db; }
    .mini td { padding: .05rem .9rem .05rem 0; }

    /* Optional rule O1: a lineman out of position, pinned to the bottom of the card. */
    .oop {
      position: absolute; left: .8rem; right: .8rem; bottom: .8rem; padding: .5rem .7rem; border-radius: 6px;
      background: #3f3f46; color: #f4f4f5; text-align: center; display: grid; gap: .15rem;
    }
    .oop strong { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
    .oop span { font-size: .85rem; }
    .printed { color: #9ca3af; text-decoration-thickness: 2px; margin-right: .35rem; }
    .counts { font-weight: 700; }

    /*
     * The printed-card look for linemen, linebackers and backs, spaced like the originals.
     * Linemen: a blank line everywhere, also between each heading and its value.
     * Linebackers and backs (more on the card): each heading right on its value, a clear gap between items.
     */
    .line-card { text-align: center; }
    .line-card .pos { margin-top: .35rem; }
    .line-card h2 { margin: 1.6rem 0 1.9rem; }
    .stat { margin-top: 1.7rem; }
    .stat:first-of-type { margin-top: 0; }
    .stat h3 { margin: 0 0 1.1rem; font-size: 1.05rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .stat p { font-size: 1.1rem; font-variant-numeric: tabular-nums; }
    /* Same distance from the top as the linemen's names, so every card's name sits at the same height. */
    .compact h2 { margin: 1.6rem 0 1.5rem; }
    .compact .stat { margin-top: 1.15rem; }
    .compact .stat:first-of-type { margin-top: 0; }
    .compact .stat h3 { margin-bottom: .15rem; }

    /*
     * Every card in the game has the same size (a quarterback's, the biggest). Linemen, linebackers and backs have
     * few numbers, so theirs spread evenly down the card, a little larger, like the printed originals: the free space
     * goes before each item and after the last, so nothing bunches at the top.
     */
    .line-card { display: flex; flex-direction: column; }
    .line-card .stat, .line-card .stat:first-of-type, .compact .stat, .compact .stat:first-of-type { margin-top: auto; }
    .line-card::after { content: ''; margin-top: auto; }
    .line-card .stat h3 { font-size: 1.1rem; }
    .line-card .stat p { font-size: 1.35rem; font-weight: 600; }
    .line-card.has-oop { padding-bottom: 5.2rem; } /* room for the out-of-position box at the bottom */
  `,
})
export class PlayerCardView {
  readonly player = input.required<PlayerCard>();
  readonly teamName = input<string>('');
  readonly injury = input<Injury | undefined>(undefined);
  /** Optional rule O1, e.g. "Guard playing tackle"; null when he plays his own position. */
  readonly outOfPosition = input<string | null>(null);
  protected readonly injuryText = injuryText;

  protected readonly twelve = Array.from({ length: 12 }, (_, i) => i);
  protected readonly row = row;
  protected readonly signed = signed;
  protected readonly fmt = formatRange;

  /** Linemen, linebackers and backs get the printed-card layout. */
  protected readonly lineCard = computed(() => ['OT', 'OG', 'C', 'DE', 'DT', 'LB', 'DB'].includes(this.player().position));

  protected readonly subtitle = computed(() => {
    const p = this.player();
    const name = POSITION_NAMES[p.position];
    if (p.position === 'RB' || p.position === 'WR' || p.position === 'TE') return `${name} - ${p.playDirection}`;
    if (p.position === 'DB' && p.role) return p.role === 'CB' ? 'Cornerback' : 'Safety';
    return name;
  });

  protected readonly passing = computed(() => {
    const p = this.player();
    if (p.position !== 'QB') return [] as { label: string; r: PassingRanges }[];
    return [
      { label: 'Quick', r: p.passing.quick },
      { label: 'Short', r: p.passing.short },
      { label: 'Long', r: p.passing.long },
    ];
  });
}
