export interface LabelColors {
  background: string;
  text: string;
}

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const expandHex = (hex: string): string =>
  hex.length === 3
    ? hex
        .split('')
        .map((c) => c + c)
        .join('')
    : hex;

const luminance = (r: number, g: number, b: number): number => {
  const ch = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};

/** The luminance at which white and black are equally readable on a colour. */
const WHITE_BLACK_CROSSOVER = 0.1791;

const DEFAULT_BG = '#3a3a3a';

export const labelColors = (bc: string | undefined | null): LabelColors => {
  const raw = (bc ?? '').trim();
  const m = raw.match(HEX);
  if (!m) {
    return { background: raw || DEFAULT_BG, text: '#ffffff' };
  }
  const hex = expandHex(m[1]!);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const text = luminance(r, g, b) > WHITE_BLACK_CROSSOVER ? '#1a1a1a' : '#ffffff';
  return { background: `#${hex}`, text };
};
