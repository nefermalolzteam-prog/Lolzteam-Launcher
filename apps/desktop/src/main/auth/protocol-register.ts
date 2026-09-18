import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

const linuxDesktopFileName = (scheme: string) => `lolzteam-${scheme}-handler.desktop`;

const linuxDesktopFilePath = (scheme: string) =>
  join(homedir(), '.local', 'share', 'applications', linuxDesktopFileName(scheme));

export const escapeDesktopExecArg = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/%/g, '%%');

const quoted = (value: string): string => `"${escapeDesktopExecArg(value)}"`;

const buildLinuxDesktopFile = (scheme: string, exec: string, productName: string): string => {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${productName} (${scheme}://)`,
    'Comment=Deep-link handler for OAuth callback',
    `Exec=${exec}`,
    'Terminal=false',
    'NoDisplay=true',
    `MimeType=x-scheme-handler/${scheme};`,
    'Categories=Network;',
    '',
  ].join('\n');
};

const run = (cmd: string, args: string[]) =>
  new Promise<void>((done) => {
    execFile(cmd, args, (err) => {
      if (err) log.warn(`[lolz][protocol] ${cmd} failed:`, err.message);
      done();
    });
  });

const resolveDevProjectRoot = (): string => {
  const argvEntry = process.argv[1];
  if (argvEntry) {
    const absEntry = isAbsolute(argvEntry) ? argvEntry : resolve(process.cwd(), argvEntry);
    if (existsSync(absEntry)) {
      const lower = absEntry.toLowerCase();
      if (lower.includes('out/main') || lower.includes('out\\main')) {
        return resolve(dirname(absEntry), '..', '..');
      }
      if (existsSync(join(absEntry, 'package.json'))) return absEntry;
      return dirname(absEntry);
    }
  }
  return process.cwd();
};

export const buildLinuxExecLine = (opts: {
  appImage: string | undefined;
  isPackaged: boolean;
  execPath: string;
  projectRoot: () => string;
}): string => {
  if (opts.appImage) return `${quoted(opts.appImage)} --no-sandbox %u`;
  if (opts.isPackaged) return `${quoted(opts.execPath)} %u`;
  return `${quoted(opts.execPath)} ${quoted(opts.projectRoot())} %u`;
};

const linuxExecLine = (): string =>
  buildLinuxExecLine({
    appImage: process.env.APPIMAGE,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    projectRoot: resolveDevProjectRoot,
  });

export const registerProtocol = async (scheme: string): Promise<void> => {
  if (process.platform === 'linux') {
    await writeLinuxDesktopFile(scheme);
    return;
  }

  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(scheme);
  } else {
    const projectRoot = resolveDevProjectRoot();
    app.setAsDefaultProtocolClient(scheme, process.execPath, [projectRoot]);
  }
};

const writeLinuxDesktopFile = async (scheme: string) => {
  const target = linuxDesktopFilePath(scheme);
  const content = buildLinuxDesktopFile(scheme, linuxExecLine(), 'Lolzteam Launcher');

  try {
    await fs.mkdir(dirname(target), { recursive: true });
    let needWrite = true;
    try {
      const existing = await fs.readFile(target, 'utf8');
      if (existing === content) needWrite = false;
    } catch {
      needWrite = true;
    }
    if (needWrite) {
      await fs.writeFile(target, content, { mode: 0o644 });
      log.info(`[lolz][protocol] wrote ${target}`);
      await run('update-desktop-database', [dirname(target)]);
      await run('xdg-mime', [
        'default',
        linuxDesktopFileName(scheme),
        `x-scheme-handler/${scheme}`,
      ]);
    }
  } catch (err) {
    log.warn('[lolz][protocol] failed to register linux desktop file:', err);
  }
};
