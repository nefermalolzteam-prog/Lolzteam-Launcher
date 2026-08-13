import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { initI18n } from '~/i18n';
import { installLauncher } from './launcher';

// The real dictionaries, in the app's own language.
await initI18n('ru');

/** jsdom implements neither, and both are load-bearing here: the account grid counts its columns with a `ResizeObserver`. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;

globalThis.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof globalThis.matchMedia;

/** jsdom lays nothing out, so `offsetParent` is `null` for every element on the page. */
Object.defineProperty(globalThis.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement): Element | null {
    if (!this.isConnected) return null;
    for (let el: HTMLElement | null = this; el !== null; el = el.parentElement) {
      if (el.hidden || el.style.display === 'none') return null;
    }
    return this.parentElement;
  },
});

// A fresh stub per test, so an override left behind by one cannot decide the outcome of the next.
beforeEach(() => {
  installLauncher();
});

afterEach(() => {
  cleanup();
});
