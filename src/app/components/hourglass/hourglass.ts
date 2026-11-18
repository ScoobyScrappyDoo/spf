import { Component, input } from '@angular/core';

/** A small hourglass: this back or receiver is resting under his play-direction rating (rule 4.6). */
@Component({
  selector: 'spf-hourglass',
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" role="img" aria-label="resting">
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h12M6 21h12" />
        <path d="M7 3c0 5 10 5 10 9s-10 4-10 9" />
        <path d="M17 3c0 5-10 5-10 9s10 4 10 9" />
      </g>
    </svg>
  `,
  styles: `:host { display: inline-flex; vertical-align: middle; }`,
})
export class Hourglass {
  readonly size = input(16);
}
