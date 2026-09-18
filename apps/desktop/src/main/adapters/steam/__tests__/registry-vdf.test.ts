import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patchSteamRegistryVdf } from '../registry-vdf';
import { parseVdf } from '../vdf-parse';

// Trimmed copy of a registry.vdf written by the Linux Steam client.
const REAL = `"Registry"
{
	"HKLM"
	{
		"Software"
		{
			"Valve"
			{
				"Steam"
				{
					"SteamPID"		"4163763"
				}
			}
		}
	}
	"HKCU"
	{
		"Software"
		{
			"Valve"
			{
				"Steam"
				{
					"language"		"english"
					"SourceModInstallPath"		"/home/u/.local/share/Steam/steamapps\\\\sourcemods"
					"AutoLoginUser"		"olduser"
					"Rate"		"30000"
				}
			}
		}
	}
}
`;

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lolz-registry-'));
  path = join(dir, 'registry.vdf');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const hkcuSteam = async () => {
  const root = parseVdf(await fs.readFile(path, 'utf8'));
  const reg = root.Registry as Record<
    string,
    Record<string, Record<string, Record<string, Record<string, string>>>>
  >;
  return reg.HKCU!.Software!.Valve!.Steam!;
};

describe('patchSteamRegistryVdf', () => {
  it('replaces AutoLoginUser without touching the rest of the file', async () => {
    await fs.writeFile(path, REAL, 'utf8');
    await patchSteamRegistryVdf(path, { AutoLoginUser: 'newuser', RememberPassword: '1' });

    const steam = await hkcuSteam();
    expect(steam.AutoLoginUser).toBe('newuser');
    expect(steam.RememberPassword).toBe('1');
    expect(steam.language).toBe('english');
    expect(steam.Rate).toBe('30000');
    expect(steam.SourceModInstallPath).toBe('/home/u/.local/share/Steam/steamapps\\sourcemods');
  });

  it('leaves the HKLM branch intact', async () => {
    await fs.writeFile(path, REAL, 'utf8');
    await patchSteamRegistryVdf(path, { AutoLoginUser: 'newuser' });

    const root = parseVdf(await fs.readFile(path, 'utf8')) as never as {
      Registry: { HKLM: { Software: { Valve: { Steam: { SteamPID: string } } } } };
    };
    expect(root.Registry.HKLM.Software.Valve.Steam.SteamPID).toBe('4163763');
  });

  it('deletes a key when given null', async () => {
    await fs.writeFile(path, REAL, 'utf8');
    await patchSteamRegistryVdf(path, { AutoLoginUser: null });
    expect(await hkcuSteam()).not.toHaveProperty('AutoLoginUser');
  });

  it('creates the file and its nesting when Steam has never run', async () => {
    await patchSteamRegistryVdf(path, { AutoLoginUser: 'newuser' });
    expect(await hkcuSteam()).toEqual({ AutoLoginUser: 'newuser' });
  });

  it('refuses to overwrite a file it could not parse', async () => {
    await fs.writeFile(path, 'this is not a vdf file at all', 'utf8');
    await expect(patchSteamRegistryVdf(path, { AutoLoginUser: 'newuser' })).rejects.toThrow(
      /could not parse/,
    );
    expect(await fs.readFile(path, 'utf8')).toBe('this is not a vdf file at all');
  });
});
