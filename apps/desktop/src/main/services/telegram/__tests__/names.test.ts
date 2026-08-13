import { describe, expect, it } from 'vitest';
import { BIO_MAX, NameGenerator, generateBio } from '../names';

const pairs = (gen: NameGenerator, n: number): string[] =>
  Array.from({ length: n }, () => {
    const name = gen.next();
    return `${name.firstName} ${name.lastName}`;
  });

describe('NameGenerator', () => {
  it('does not repeat a pair while the pool has room', () => {
    const names = pairs(new NameGenerator('mixed', 'mixed'), 200);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the gender it was asked for', () => {
    const gen = new NameGenerator('female', 'ru');
    for (let i = 0; i < 50; i += 1) expect(gen.next().gender).toBe('female');
  });

  it('agrees the Russian surname with the gender', () => {
    const female = new NameGenerator('female', 'ru');
    for (let i = 0; i < 100; i += 1) expect(female.next().lastName.endsWith('а')).toBe(true);

    const male = new NameGenerator('male', 'ru');
    for (let i = 0; i < 100; i += 1) {
      expect(/(ов|ев|ёв|ин)$/.test(male.next().lastName)).toBe(true);
    }
  });

  it('leaves an English surname alone', () => {
    const gen = new NameGenerator('female', 'en');
    for (let i = 0; i < 50; i += 1) {
      const { firstName, lastName } = gen.next();
      expect(/^[A-Za-z]+$/.test(firstName)).toBe(true);
      expect(/^[A-Za-z]+$/.test(lastName)).toBe(true);
    }
  });

  it('draws from both languages when asked to mix', () => {
    const gen = new NameGenerator('mixed', 'mixed');
    const locales = new Set(Array.from({ length: 200 }, () => gen.next().locale));
    expect(locales).toEqual(new Set(['ru', 'en']));
  });

  // The pool is finite; once it is out the run has to keep going rather than loop looking for a pair that no longer exists.
  it('keeps producing names past the size of a single-gender pool', () => {
    const gen = new NameGenerator('male', 'en');
    expect(pairs(gen, 6000)).toHaveLength(6000);
  });
});

describe('generateBio', () => {
  it('never exceeds the limit Telegram enforces', () => {
    for (const locale of ['ru', 'en'] as const) {
      for (let i = 0; i < 200; i += 1) {
        expect(generateBio(locale).length).toBeLessThanOrEqual(BIO_MAX);
      }
    }
  });

  /** Russian past-tense verbs carry gender, so «родилась» under a man's name is exactly the tell this pool exists to avoid. */
  it('has no gendered past-tense verb in the Russian pool', () => {
    for (let i = 0; i < 300; i += 1) {
      expect(generateBio('ru')).not.toMatch(/(лся|лась|ился|илась)/);
    }
  });
});
