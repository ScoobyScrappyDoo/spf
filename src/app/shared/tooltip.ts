import { Directive, ElementRef, inject, input, OnDestroy } from '@angular/core';

/**
 * The game's own tooltip, instead of the browser's (which can't be styled): one look everywhere, set in styles.scss
 * (.spf-tip). Use it like a title: <button spfTip="Out of range">. Shows after a short pause on hover or keyboard
 * focus, above the element, or below it when there's no room; hides on leave, click or scroll.
 */
@Directive({
  selector: '[spfTip]',
  host: {
    '(mouseenter)': 'show()',
    '(focusin)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusout)': 'hide()',
    '(click)': 'hide()',
  },
})
export class Tooltip implements OnDestroy {
  readonly spfTip = input<string | null | undefined>('');
  private readonly host = inject(ElementRef<Element>);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private static tip: HTMLDivElement | null = null;
  private static owner: Tooltip | null = null;

  show() {
    const text = this.spfTip()?.trim();
    if (!text) return;
    this.clear();
    this.timer = setTimeout(() => this.place(text), 350);
  }

  hide() {
    this.clear();
    if (Tooltip.owner === this && Tooltip.tip) {
      Tooltip.tip.classList.remove('on');
      Tooltip.owner = null;
    }
  }

  ngOnDestroy() {
    this.hide();
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private place(text: string) {
    const tip = (Tooltip.tip ??= Tooltip.create());
    tip.textContent = text;
    tip.classList.add('on');
    Tooltip.owner = this;
    const r = this.host.nativeElement.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    const above = r.top - t.height - gap >= 4;
    const top = above ? r.top - t.height - gap : r.bottom + gap;
    const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tip.classList.toggle('below', !above);
  }

  private static create(): HTMLDivElement {
    const tip = document.createElement('div');
    tip.className = 'spf-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    // A tooltip left behind after scrolling would point at nothing.
    window.addEventListener('scroll', () => Tooltip.owner?.hide(), { passive: true, capture: true });
    return tip;
  }
}
