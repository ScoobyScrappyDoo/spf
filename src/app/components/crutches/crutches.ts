import { Component, input } from '@angular/core';

/** A small pair of crutches: marks an injured player without shouting about it. */
@Component({
  selector: 'spf-crutches',
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" role="img" aria-label="injured">
      <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M5 4h4M7 4l2.2 17M5.8 11.5h3.6" />
        <path d="M15 4h4M17 4l-2.2 17M14.6 11.5h3.6" />
      </g>
    </svg>
  `,
  styles: `:host { display: inline-flex; vertical-align: middle; }`,
})
export class Crutches {
  readonly size = input(16);
}
