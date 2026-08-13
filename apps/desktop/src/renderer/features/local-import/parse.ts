const meaningful = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));

/** `login:pass`, `login;pass` or `login<space>pass`. */
export const countCredentialLines = (text: string): number =>
  meaningful(text).filter((line) => {
    const at = line.search(/[:;\s\t]/);
    return at > 0 && line.slice(at + 1).trim().length > 0;
  }).length;

/** A 256-byte key is 512 hex chars; anything shorter cannot be one. */
export const countAuthKeyLines = (text: string): number =>
  meaningful(text).filter((line) => /[0-9a-fA-F]{512}/.test(line)).length;
