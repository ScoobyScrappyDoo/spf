import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader, SECTIONS } from '../../shell/page-header';

@Component({
  selector: 'spf-coming-soon',
  imports: [PageHeader, RouterLink],
  host: { '[style.--page-bg]': 'pageColor()' },
  template: `
    <spf-page-header [title]="label()" />
    <section>
      <p>{{ label() }} isn't built yet. The offense selection screen is ready to try.</p>
      <a routerLink="/offense">Open offense selection</a>
    </section>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--page-bg); }
    :host { min-width: var(--page-min-width); }
    section { color: white; padding: 2rem; font-size: 1.05rem; }
    a { color: white; }
  `,
})
export class ComingSoon {
  /** Bound from the :section route parameter (withComponentInputBinding). */
  readonly section = input<string>('');
  /** The page takes its menu tab's colour (see --page-* in styles.scss). */
  protected readonly pageColor = computed(() => `var(--page-${this.section() === 'play-by-play' ? 'pbp' : this.section()}, var(--spf-field))`);
  protected readonly label = computed(() => SECTIONS.find(s => s.path === this.section())?.label ?? 'This screen');
}
