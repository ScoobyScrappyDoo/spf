import { SETTINGS } from '../../settings';
import { Component, inject } from '@angular/core';
import { GameStore } from '../../state/game.store';
import { RouterLink } from '@angular/router';

import { Tooltip } from '../../shared/tooltip';
@Component({
  selector: 'spf-dashboard',
  imports: [Tooltip, RouterLink],
  template: `
    <main>
      <h1>{{ gameName }} Dashboard</h1>
      <div class="grid">
        <div class="teams">
          @if (game.unlocked()) {
            <a routerLink="/offense" class="tile square" style="--c: var(--tile-offense)">
            <svg viewBox="0 0 48 48" class="gear" aria-hidden="true"><path [attr.d]="gear" /></svg>
            Offense
          </a>
          } @else {
            <div class="tile square locked" style="--c: var(--tile-offense)" aria-disabled="true" spfTip="Start a game first">
            <svg viewBox="0 0 48 48" class="gear" aria-hidden="true"><path [attr.d]="gear" /></svg>
            Offense
          <small>Start a game first</small></div>
          }
          @if (game.unlocked()) {
            <a routerLink="/defense" class="tile square" style="--c: var(--tile-defense)">
            <svg viewBox="0 0 48 48" class="gear" aria-hidden="true"><path [attr.d]="gear" /></svg>
            Defense
          </a>
          } @else {
            <div class="tile square locked" style="--c: var(--tile-defense)" aria-disabled="true" spfTip="Start a game first">
            <svg viewBox="0 0 48 48" class="gear" aria-hidden="true"><path [attr.d]="gear" /></svg>
            Defense
          <small>Start a game first</small></div>
          }
        </div>
        <div class="flow">
          <a routerLink="/game" class="tile wide" style="--c: var(--tile-game)">
            <svg viewBox="0 0 64 48" aria-hidden="true"><path d="M14 8h36c8 0 12 10 12 22 0 8-4 12-8 12-5 0-7-6-12-6H22c-5 0-7 6-12 6-4 0-8-4-8-12C2 18 6 8 14 8Z" fill="white"/><circle cx="20" cy="22" r="5" fill="var(--c)"/><circle cx="40" cy="22" r="2.5" fill="var(--c)"/><circle cx="48" cy="22" r="2.5" fill="var(--c)"/></svg>
            <span class="label">Game<small class="cta">{{ game.state() ? 'Continue game' : 'Start here' }}</small></span>
          </a>
          @if (game.unlocked()) {
            <a routerLink="/stats" class="tile wide" style="--c: var(--tile-stats)">
            <svg viewBox="0 0 64 48" aria-hidden="true" fill="white"><path d="M4 4 A20 20 0 0 1 4 44 Z"/><rect x="38" y="4" width="14" height="10"/><rect x="38" y="19" width="14" height="10"/><rect x="38" y="34" width="14" height="10"/><rect x="24" y="8" width="12" height="2"/><rect x="24" y="23" width="12" height="2"/><rect x="24" y="38" width="12" height="2"/></svg>
            Stats
          </a>
          } @else {
            <div class="tile wide locked" style="--c: var(--tile-stats)" aria-disabled="true" spfTip="Start a game first">
            <svg viewBox="0 0 64 48" aria-hidden="true" fill="white"><path d="M4 4 A20 20 0 0 1 4 44 Z"/><rect x="38" y="4" width="14" height="10"/><rect x="38" y="19" width="14" height="10"/><rect x="38" y="34" width="14" height="10"/><rect x="24" y="8" width="12" height="2"/><rect x="24" y="23" width="12" height="2"/><rect x="24" y="38" width="12" height="2"/></svg>
            Stats
          <small>Start a game first</small></div>
          }
          @if (game.unlocked()) {
            <a routerLink="/play-by-play" class="tile wide" style="--c: var(--tile-pbp)">
            <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="16" y="3" width="16" height="28" rx="8" fill="white"/><path d="M10 22a14 14 0 0 0 28 0M24 36v8M16 44h16" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>
            Play by play
          </a>
          } @else {
            <div class="tile wide locked" style="--c: var(--tile-pbp)" aria-disabled="true" spfTip="Start a game first">
            <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="16" y="3" width="16" height="28" rx="8" fill="white"/><path d="M10 22a14 14 0 0 0 28 0M24 36v8M16 44h16" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>
            Play by play
          <small>Start a game first</small></div>
          }
          @if (game.unlocked()) {
            <a routerLink="/data" class="tile wide" style="--c: var(--tile-data)">
            <svg viewBox="0 0 64 48" aria-hidden="true" fill="white"><rect x="6" y="26" width="9" height="18"/><rect x="19" y="14" width="9" height="30"/><rect x="32" y="4" width="9" height="40"/><circle cx="50" cy="26" r="6"/><path d="M38 46c0-8 5-12 12-12s12 4 12 12Z"/></svg>
            Data
          </a>
          } @else {
            <div class="tile wide locked" style="--c: var(--tile-data)" aria-disabled="true" spfTip="Start a game first">
            <svg viewBox="0 0 64 48" aria-hidden="true" fill="white"><rect x="6" y="26" width="9" height="18"/><rect x="19" y="14" width="9" height="30"/><rect x="32" y="4" width="9" height="40"/><circle cx="50" cy="26" r="6"/><path d="M38 46c0-8 5-12 12-12s12 4 12 12Z"/></svg>
            Data
          <small>Start a game first</small></div>
          }
          <a routerLink="/rosters" class="tile wide" style="--c: var(--tile-rosters)">
            <svg viewBox="0 0 64 48" aria-hidden="true" fill="white"><rect x="8" y="6" width="22" height="30" rx="3"/><rect x="34" y="12" width="22" height="30" rx="3" opacity=".7"/><rect x="12" y="12" width="14" height="3" fill="#3e6b45"/><rect x="12" y="18" width="10" height="2" fill="#3e6b45"/></svg>
            Rosters
          </a>
        </div>
      </div>
    </main>
  `,
  styles: `
    :host { display: block; min-width: var(--dashboard-min-width); }
    main { padding: 2.5rem 2rem; max-width: 760px; }
    h1 { font-weight: 300; font-size: clamp(1.7rem, 3.2vw, 2.2rem); margin: 0 0 1.25rem .3rem; }
    .grid { display: grid; grid-template-columns: auto 1fr; gap: 4.5rem; align-items: start; }
    .teams { display: flex; gap: .6rem; }
    .flow { display: grid; gap: .6rem; max-width: 310px; }
    .tile {
      display: flex; align-items: center; justify-content: center; gap: 1.2rem; color: white; text-decoration: none;
      background: linear-gradient(110deg, var(--c), color-mix(in srgb, var(--c) 78%, white));
      transition: filter .12s;
    }
    .tile:hover { filter: brightness(1.08); }
    .label { display: grid; }
    .cta { font-size: .8rem; margin-top: .15rem; padding: .1rem .45rem; border-radius: 3px; background: white; color: #4b4b4b; font-weight: 600; justify-self: start; }
    .tile.locked { filter: grayscale(1) opacity(.35); cursor: not-allowed; position: relative; }
    .tile.locked small { position: absolute; bottom: .6rem; left: 0; right: 0; text-align: center; font-size: .78rem; }
    .square { width: 150px; height: 150px; flex-direction: column; gap: .5rem; }
    .wide { height: 150px; }
    .wide svg { width: 64px; height: 48px; }
    .gear { width: 58px; height: 58px; fill: color-mix(in srgb, var(--c) 70%, #1b2a40); }
  `,
})
export class Dashboard {
  protected readonly game = inject(GameStore);
  protected readonly gameName = SETTINGS.gameName;

  /** A simple eight-tooth gear, drawn once and reused by both team tiles. */
  protected readonly gear = (() => {
    const pts: string[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r1 = i % 2 === 0 ? 22 : 16;
      const a2 = a + Math.PI / 8;
      pts.push(`${24 + r1 * Math.cos(a)},${24 + r1 * Math.sin(a)}`, `${24 + r1 * Math.cos(a2 - 0.12)},${24 + r1 * Math.sin(a2 - 0.12)}`);
    }
    return `M${pts.join(' L')} Z M24,17 a7,7 0 1,0 0.01,0 Z`;
  })();
}
