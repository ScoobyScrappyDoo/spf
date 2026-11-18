import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, viewChild } from '@angular/core';
import { Intensity, WeatherService, Wind } from '../../state/weather.service';

/** The field as drawn on the Game tab at 1920 x 1080: sizes and counts below are for this, and scale with it. */
const BASE_W = 832;
const BASE_H = 370;

/** Per intensity (light, medium, heavy). */
const RAIN = { count: [100, 200, 400], alpha: [0.36, 0.42, 0.48], length: [10, 14, 18], tint: [0.04, 0.1, 0.18] };
const SNOW = { count: [120, 300, 650], haze: [0, 0.06, 0.14] };
const WIND = { gusts: [8, 16, 30], bits: [14, 32, 70], alpha: [0.3, 0.38, 0.46] };

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

interface Drop { x: number; y: number; t: number; life: number; len: number }
interface Splash { x: number; y: number; t: number; life: number; r: number }
interface Flake { x: number; y: number; depth: number; phase: number; age: number }
interface Gust { x: number; y: number; t: number; life: number; len: number; phase: number; width: number }
interface Bit { x: number; y: number; angle: number; spin: number; color: string }

/**
 * Rain, snow or wind over the field, seen from above like a stadium camera: rain falls in short streaks and splashes
 * on the grass, snow drifts down in flakes of different sizes (the nearer, the bigger and faster), wind blows thin gusts
 * and bits of grass across, with a flag showing where it blows and how hard. Nothing covers the lines: heavy rain only
 * darkens the sky a little, heavy snow adds a faint haze.
 *
 * A canvas, drawn about 60 times a second with requestAnimationFrame. Angular isn't involved in the frames (this app
 * has no zone.js, so they don't set off change detection); an effect starts the weather afresh when it changes.
 * The random numbers are the browser's own, never the game's, so the weather can't change how a game plays out.
 * It moves even when the computer asks for less motion; the "Moving" tick box on the Game tab stops it.
 */
@Component({
  selector: 'spf-weather-layer',
  template: `
    <canvas #canvas aria-hidden="true"></canvas>
    @if (weather.conditions() === 'wind') {
      <div class="wind" [attr.aria-label]="'Wind ' + weather.wind().mph + ' miles an hour'">
        <svg viewBox="-12 -12 24 24" [style.transform]="'rotate(' + weather.wind().towards + 'deg)'" aria-hidden="true">
          <path d="M-9 0H6M1 -5L7 0L1 5" />
        </svg>
        <span>{{ weather.wind().mph }} mph</span>
      </div>
    }
  `,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: 6px; }
    canvas { display: block; width: 100%; height: 100%; }
    /* The wind in the corner of the right end zone, where it covers no lines. */
    .wind {
      position: absolute; top: 2.2%; right: 1%; display: grid; justify-items: center; gap: .1rem; padding: .3rem .35rem .25rem;
      border-radius: 6px; background: rgba(0, 0, 0, .45); color: white; font-size: .68rem; font-weight: 600; white-space: nowrap;
    }
    .wind svg { width: 1.5rem; height: 1.5rem; transition: transform .4s ease; }
    .wind path { fill: none; stroke: white; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  `,
})
export class WeatherLayer {
  protected readonly weather = inject(WeatherService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  /** Everything that sets the scene: when one of these changes, the weather starts afresh. */
  private readonly scene = computed(() => ({ kind: this.weather.conditions(), level: this.weather.intensity(), wind: this.weather.wind() }));

  private w = 0;
  private h = 0;
  private s = 1;
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private flakes: Flake[] = [];
  private gusts: Gust[] = [];
  private bits: Bit[] = [];
  private frame = 0;
  private last = 0;
  private time = 0;
  /** "Moving" unticked: the weather stands still (drawn once, as it was when it stopped). */
  private get still() {
    return !this.weather.moving();
  }

  constructor() {
    effect(() => {
      this.scene();
      this.reset();
    });
    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.resize());
      observer.observe(this.host.nativeElement);
      this.resize();
      const loop = (now: number) => {
        const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0);
        this.last = now;
        if (!this.still) this.step(dt);
        this.draw();
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
      this.destroyRef.onDestroy(() => {
        cancelAnimationFrame(this.frame);
        observer.disconnect();
      });
    });
  }

  private resize() {
    const el = this.canvas().nativeElement;
    const box = this.host.nativeElement.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.w = box.width;
    this.h = box.height;
    this.s = box.width / BASE_W;
    el.width = Math.round(box.width * ratio);
    el.height = Math.round(box.height * ratio);
    el.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.reset();
  }

  /** How many of something, for this size of field (counted for the field at 1920 x 1080). */
  private count(base: number) {
    return Math.round((base * this.w * this.h) / (BASE_W * BASE_H));
  }

  private reset() {
    const { kind, level } = this.scene();
    this.drops = [];
    this.splashes = [];
    this.flakes = [];
    this.gusts = [];
    this.bits = [];
    if (!this.w) return;
    if (kind === 'rain') for (let i = 0; i < this.count(RAIN.count[level]); i++) this.drops.push(this.newDrop(level, true));
    if (kind === 'snow') for (let i = 0; i < this.count(SNOW.count[level]); i++) this.flakes.push(this.newFlake(true));
    if (kind === 'wind') {
      for (let i = 0; i < this.count(WIND.gusts[level]); i++) this.gusts.push(this.newGust(true));
      for (let i = 0; i < this.count(WIND.bits[level]); i++) this.bits.push(this.newBit());
    }
    if (this.still) this.step(0);
  }

  // ---------------------------------------------------------------------------------------------
  // Moving things on
  // ---------------------------------------------------------------------------------------------

  /** The wind as a speed on screen (px/s) at the field's size, times a factor. */
  private windVector(wind: Wind, factor: number) {
    const a = (wind.towards * Math.PI) / 180;
    return { x: Math.cos(a) * wind.mph * factor * this.s, y: Math.sin(a) * wind.mph * factor * this.s };
  }

  private step(dt: number) {
    const { kind, level, wind } = this.scene();
    this.time += dt;
    if (kind === 'rain') this.stepRain(dt, level, wind);
    if (kind === 'snow') this.stepSnow(dt, wind);
    if (kind === 'wind') this.stepWind(dt, wind);
  }

  /** A raindrop appears and falls for a moment, then splashes where it lands; a new one takes its place. */
  private newDrop(level: Intensity, anywhere = false): Drop {
    const life = rnd(0.12, 0.24);
    return { x: rnd(-20, this.w + 20), y: rnd(-20, this.h), t: anywhere ? rnd(0, life) : 0, life, len: RAIN.length[level] * rnd(0.7, 1.3) * this.s };
  }

  private stepRain(dt: number, level: Intensity, wind: Wind) {
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.t += dt;
      if (d.t >= d.life) {
        const v = this.rainVelocity(wind);
        this.splashes.push({ x: d.x + v.x * d.life, y: d.y + v.y * d.life, t: 0, life: rnd(0.25, 0.4), r: rnd(2.5, 5.5) * this.s });
        this.drops[i] = this.newDrop(level);
      }
    }
    for (const sp of this.splashes) sp.t += dt;
    this.splashes = this.splashes.filter(sp => sp.t < sp.life);
  }

  /** Down the screen (the camera looks a little across the field), slanted by the breeze. */
  private rainVelocity(wind: Wind) {
    const w = this.windVector(wind, 9);
    return { x: w.x, y: 900 * this.s + w.y * 0.5 };
  }

  private newFlake(anywhere = false): Flake {
    return { x: rnd(0, this.w), y: anywhere ? rnd(0, this.h) : rnd(-10, 0), depth: Math.random() ** 1.6, phase: rnd(0, Math.PI * 2), age: anywhere ? 1 : 0 };
  }

  /** Flakes drift down and sway; the nearer ones (depth near 1) are bigger and faster. Off one edge, back on the other. */
  private stepSnow(dt: number, wind: Wind) {
    const breeze = this.windVector(wind, 1.6);
    for (const f of this.flakes) {
      const near = 0.4 + f.depth;
      f.age += dt;
      f.y += (16 + 44 * f.depth) * this.s * dt + breeze.y * near * dt * 0.3;
      f.x += Math.sin(this.time * 1.2 + f.phase) * 14 * near * this.s * dt + breeze.x * near * dt;
      if (f.y > this.h + 6) Object.assign(f, this.newFlake());
      if (f.x > this.w + 6) f.x -= this.w + 12;
      if (f.x < -6) f.x += this.w + 12;
    }
  }

  /** A gust: a thin wavy streak that blows across in the wind's direction, fading in and out. */
  private newGust(anywhere = false): Gust {
    const life = rnd(1.1, 2.1);
    return {
      x: rnd(-0.2, 1.2) * this.w, y: rnd(-0.1, 1.1) * this.h, t: anywhere ? rnd(0, life) : 0, life,
      len: rnd(90, 240) * this.s, phase: rnd(0, Math.PI * 2), width: rnd(1, 2.2),
    };
  }

  private newBit(): Bit {
    const colors = ['#c9d98a', '#a7c46a', '#d8cf93', '#8fae55'];
    return { x: rnd(0, this.w), y: rnd(0, this.h), angle: rnd(0, Math.PI), spin: rnd(-8, 8), color: colors[Math.floor(Math.random() * colors.length)] };
  }

  private stepWind(dt: number, wind: Wind) {
    const v = this.windVector(wind, 14);
    for (let i = 0; i < this.gusts.length; i++) {
      const g = this.gusts[i];
      g.t += dt;
      g.x += v.x * dt;
      g.y += v.y * dt;
      if (g.t >= g.life) this.gusts[i] = this.newGust();
    }
    // Bits of grass: a little slower than the gusts, tumbling, a little unsteady; off one edge, back on the other.
    for (const b of this.bits) {
      const wobble = Math.sin(this.time * 3 + b.angle * 5);
      b.x += (v.x * 0.8 + wobble * 12 * this.s) * dt;
      b.y += (v.y * 0.8 + wobble * 10 * this.s) * dt;
      b.angle += b.spin * dt;
      if (b.x > this.w + 4) b.x = -4;
      if (b.x < -4) b.x = this.w + 4;
      if (b.y > this.h + 4) b.y = -4;
      if (b.y < -4) b.y = this.h + 4;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------

  private draw() {
    const ctx = this.canvas().nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    const { kind, level, wind } = this.scene();
    if (kind === 'rain') this.drawRain(ctx, level, wind);
    if (kind === 'snow') this.drawSnow(ctx, level);
    if (kind === 'wind') this.drawWind(ctx, level, wind);
  }

  private drawRain(ctx: CanvasRenderingContext2D, level: Intensity, wind: Wind) {
    // A darker sky: the field greys a little, more as the rain gets heavier.
    ctx.fillStyle = `rgba(20, 30, 50, ${RAIN.tint[level]})`;
    ctx.fillRect(0, 0, this.w, this.h);
    const v = this.rainVelocity(wind);
    const speed = Math.hypot(v.x, v.y);
    const ux = v.x / speed;
    const uy = v.y / speed;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.1 * this.s;
    ctx.strokeStyle = `rgba(215, 228, 255, ${RAIN.alpha[level]})`;
    ctx.beginPath();
    for (const d of this.drops) {
      const x = d.x + v.x * d.t;
      const y = d.y + v.y * d.t;
      ctx.moveTo(x - ux * d.len, y - uy * d.len);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Splashes: a small ring on the grass that widens and fades.
    ctx.lineWidth = 0.9 * this.s;
    for (const sp of this.splashes) {
      const k = sp.t / sp.life;
      ctx.strokeStyle = `rgba(225, 235, 255, ${0.5 * (1 - k)})`;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, sp.r * (0.3 + k), sp.r * 0.55 * (0.3 + k), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawSnow(ctx: CanvasRenderingContext2D, level: Intensity) {
    if (SNOW.haze[level]) {
      ctx.fillStyle = `rgba(255, 255, 255, ${SNOW.haze[level]})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    for (const f of this.flakes) {
      const r = (1.1 + 3.4 * f.depth) * this.s;
      const alpha = (0.55 + 0.4 * f.depth) * Math.min(1, f.age / 0.6);
      if (r > 2) {
        // The nearer flakes are soft at the edge.
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        g.addColorStop(0.6, `rgba(255, 255, 255, ${alpha * 0.8})`);
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      }
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawWind(ctx: CanvasRenderingContext2D, level: Intensity, wind: Wind) {
    const a = (wind.towards * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    ctx.lineCap = 'round';
    for (const g of this.gusts) {
      const fade = Math.sin((Math.PI * g.t) / g.life);
      ctx.strokeStyle = `rgba(255, 255, 255, ${WIND.alpha[level] * fade})`;
      ctx.lineWidth = g.width * this.s;
      ctx.beginPath();
      // Along the wind, rippling sideways a little: the ripple runs along the streak as it blows.
      for (let i = 0; i <= 12; i++) {
        const along = (i / 12 - 1) * g.len;
        const side = Math.sin(i * 0.7 + g.phase + this.time * 6) * 3 * this.s * (i / 12);
        const x = g.x + ux * along - uy * side;
        const y = g.y + uy * along + ux * side;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    for (const b of this.bits) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.2 * this.s, 1.1 * this.s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

