import { Component, computed, inject } from '@angular/core';
import { Crutches } from '../../components/crutches/crutches';
import { injuryText, Position, restingPlayers, Side, quarterLabel } from '../../engine';
import { PageHeader } from '../../shell/page-header';
import { GameStore } from '../../state/game.store';

const POSITION_ORDER: Position[] = ['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'DB', 'K', 'P'];

/** Game data. For now: who is injured, by team. The data check comes here later. */
@Component({
  selector: 'spf-data-page',
  imports: [PageHeader, Crutches],
  template: `
    <spf-page-header title="Data" />
    <main>
      <section class="frame">
        <h2>Injuries</h2>
        @for (t of teams(); track t.side) {
          <h3>{{ t.label }}</h3>
          @if (t.injuries.length) {
            <table>
              <thead><tr><th scope="col">Pos</th><th scope="col">Player</th><th scope="col">Out for</th><th scope="col">Hurt</th></tr></thead>
              <tbody>
                @for (i of t.injuries; track i.playerId) {
                  <tr>
                    <td>{{ i.position }}</td>
                    <td><spf-crutches [size]="15" /> {{ i.name }} <span class="where">({{ i.where }})</span></td>
                    <td>{{ injuryText(i.length) }}</td>
                    <td class="when">{{ q(i.quarter) }} {{ clock(i.clock) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="none">Nobody is injured.</p>
          }
        }
      </section>

      <section class="frame">
        <h2>Endurance</h2>
        <p class="note">Backs and receivers resting under their play-direction rating (rule 4.6). They stay on the field and can
          still get the ball when a card redirects a pass to them; they just can't be called.</p>
        @for (t of resting(); track t.side) {
          <h3>{{ t.label }}</h3>
          @if (t.players.length) {
            <table>
              <thead><tr><th scope="col">Pos</th><th scope="col">Player</th><th scope="col">Rating</th><th scope="col">Can be called again</th></tr></thead>
              <tbody>
                @for (r of t.players; track r.player.id) {
                  <tr><td>{{ r.player.position }}</td><td>{{ r.player.firstName }} {{ r.player.lastName }}</td><td>{{ r.rating }}</td><td>{{ r.back }}</td></tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="none">Everyone can be called.</p>
          }
        }
      </section>
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; min-width: var(--page-min-width); background: var(--page-data); }
    main { padding: 1.4rem 1.6rem 2rem; max-width: 40rem; display: grid; gap: .8rem; }
    .note { margin: 0 0 .3rem; font-size: .85rem; opacity: .8; }
    .frame { border: 6px solid var(--spf-frame); border-radius: var(--radius-panel); padding: .8rem 1.1rem; color: white; }
    h2 { margin: 0 0 .4rem; font-weight: 400; font-size: 1.2rem; }
    h3 { margin: .9rem 0 .3rem; font-size: 1rem; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th { text-align: left; font-weight: 600; opacity: .8; padding: .2rem .4rem; border-bottom: 1px solid rgba(255,255,255,.35); }
    td { padding: .3rem .4rem; border-bottom: 1px solid rgba(255,255,255,.15); }
    td:first-child { width: 3rem; }
    .where, .when { opacity: .75; }
    .when { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .none { margin: 0; opacity: .8; font-size: .9rem; }
  `,
})
export class DataPage {
  protected readonly q = quarterLabel;
  private readonly game = inject(GameStore);
  protected readonly injuryText = injuryText;

  protected readonly teams = computed(() =>
    (['away', 'home'] as Side[]).map(side => ({
      side,
      label: this.game.label(side),
      injuries: this.game
        .injuries()
        .filter(i => i.side === side)
        .sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)),
    })),
  );

  protected readonly resting = computed(() => {
    const s = this.game.state();
    const teams = this.game.teams();
    return (['away', 'home'] as Side[]).map(side => ({
      side,
      label: this.game.label(side),
      players: s && teams ? restingPlayers(s, teams[side]) : [],
    }));
  });

  protected clock(seconds: number) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
