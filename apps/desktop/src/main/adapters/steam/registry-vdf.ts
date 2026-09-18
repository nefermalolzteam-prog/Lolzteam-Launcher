import { readExisting, writeVdfFile } from './vdf';
import { emptyVdf, getObj, writeVdfString } from './vdf-parse';

// Linux has no registry, so the Steam client keeps what lives under
// `HKCU\Software\Valve\Steam` on Windows in `~/.steam/registry.vdf` instead:
//
//   "Registry" { "HKCU" { "Software" { "Valve" { "Steam" { "AutoLoginUser" ... } } } } }
//
// The client loads this file at startup and rewrites it wholesale on exit, so a
// patch only survives if Steam is already stopped when we write. Callers are
// responsible for that ordering; `control.ts` provides the shutdown.

const steamNode = (root: ReturnType<typeof emptyVdf>) =>
  getObj(getObj(getObj(getObj(getObj(root, 'Registry'), 'HKCU'), 'Software'), 'Valve'), 'Steam');

/**
 * Applies `patch` to the HKCU Steam node. A `null` value deletes the key.
 * Every other key in the file — language, install paths, other users' settings —
 * is read back and written out untouched.
 */
export const patchSteamRegistryVdf = async (
  path: string,
  patch: Readonly<Record<string, string | null>>,
): Promise<void> => {
  const root = (await readExisting(path)) ?? emptyVdf();
  const steam = steamNode(root);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete steam[key];
    else steam[key] = value;
  }
  await writeVdfFile(path, writeVdfString(root));
};
