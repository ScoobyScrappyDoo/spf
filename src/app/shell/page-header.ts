import { Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { GameStore } from '../state/game.store';

export const SECTIONS = [
  { path: 'offense', label: 'Offense', color: 'var(--tile-offense)' },
  { path: 'defense', label: 'Defense', color: 'var(--tile-defense)' },
  { path: 'game', label: 'Game', color: 'var(--tile-game)' },
  { path: 'stats', label: 'Stats', color: 'var(--tile-stats)' },
  { path: 'play-by-play', label: 'Play by play', color: 'var(--tile-pbp)' },
  { path: 'data', label: 'Data', color: 'var(--tile-data)' },
  { path: 'rosters', label: 'Rosters', color: 'var(--tile-rosters)' },
] as const;

/** Game and Rosters are always open; everything else waits for the opening kickoff. */
export const isAlwaysOpen = (path: string) => path === 'game' || path === 'rosters';

import { Tooltip } from '../shared/tooltip';
@Component({
  selector: 'spf-page-header',
  imports: [Tooltip, RouterLink, RouterLinkActive],
  template: `
    <header>
      <a routerLink="/" class="back" aria-label="Back to dashboard">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" />
          <path d="M23 12 L15 20 L23 28 M15 20 H29" />
        </svg>
      </a>
      <h1>{{ title() }}</h1>
      <nav>
        <a routerLink="/" class="home">Dashboard</a>
        @for (s of sections; track s.path) {
          @if (game.unlocked() || isAlwaysOpen(s.path)) {
            <a [routerLink]="'/' + s.path" routerLinkActive="active" [style.--tab]="s.color">{{ s.label }}</a>
          } @else {
            <span class="locked" [style.--tab]="s.color" aria-disabled="true" spfTip="Start a game first">{{ s.label }}</span>
          }
        }
      </nav>
    </header>
  `,
  styles: `
    header { display: flex; align-items: center; gap: 1rem; padding: 1.25rem 2rem; background: var(--spf-paper); }
    .back { display: grid; width: 2.6rem; height: 2.6rem; color: var(--spf-ink); }
    .back svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    h1 { margin: 0; font-weight: 300; font-size: clamp(1.6rem, 3vw, 2.1rem); flex: 1; }
    nav { display: flex; gap: 2px; }
    nav a, nav span {
      padding: .55rem .7rem; text-decoration: none; color: #3b3b3b; font-size: .95rem;
      background: color-mix(in srgb, var(--tab) 70%, white);
    }
    nav a:hover { background: color-mix(in srgb, var(--tab) 85%, white); }
    nav a.active { background: var(--tab); color: white; }
    nav a.home { background: var(--spf-home); color: white; }
    nav a.home:hover { background: color-mix(in srgb, var(--spf-home) 85%, white); }
    nav span.locked { background: #ececec; color: #a3a3a3; cursor: not-allowed; }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  protected readonly game = inject(GameStore);
  protected readonly sections = SECTIONS;
  protected readonly isAlwaysOpen = isAlwaysOpen;
}
