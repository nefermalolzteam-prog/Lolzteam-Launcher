import { type ProxyEntry, type ProxyFolder, isProxyHost } from '@shared-types';

export const proxyKey = (
  p: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password' | 'protocol'>,
): string =>
  `${p.protocol ?? 'http'}://${p.host}:${p.port}:${p.username ?? ''}:${p.password ?? ''}`;

/** What to call a proxy on screen: the user's own name when there is one, the address otherwise. */
export const proxyName = (p: ProxyEntry): string =>
  p.label?.trim() ? p.label.trim() : `${p.host}:${p.port}`;

/** The second line under the name. */
export const proxyDetail = (p: ProxyEntry): string | null => {
  if (p.label?.trim()) {
    return `${p.host}:${p.port}${p.username ? ` · ${p.username}` : ''}`;
  }
  return p.username ?? null;
};

/** Proxies of one folder; `null` picks the unfoldered ones — including entries whose folder has been deleted. */
export const inFolder = (
  proxies: readonly ProxyEntry[],
  folders: ProxyFolder[],
  id: string | null,
): ProxyEntry[] => {
  if (id === null) {
    const known = new Set(folders.map((f) => f.id));
    return proxies.filter((p) => !p.folderId || !known.has(p.folderId));
  }
  return proxies.filter((p) => p.folderId === id);
};

/** The same list split for a picker: folders in their own order, «без папки» last, empty groups dropped. */
export const groupProxiesByFolder = (
  proxies: readonly ProxyEntry[],
  folders: ProxyFolder[],
): { folder: ProxyFolder | null; items: ProxyEntry[] }[] => {
  const groups: { folder: ProxyFolder | null; items: ProxyEntry[] }[] = [];
  for (const folder of folders) {
    const items = inFolder(proxies, folders, folder.id);
    if (items.length > 0) groups.push({ folder, items });
  }
  const rest = inFolder(proxies, folders, null);
  if (rest.length > 0) groups.push({ folder: null, items: rest });
  return groups;
};

export const parseProxyLine = (line: string): Omit<ProxyEntry, 'id'> | null => {
  let rest = line.trim();
  if (!rest) return null;

  let protocol: 'http' | 'https' = 'http';
  const lower = rest.toLowerCase();
  if (lower.startsWith('https://')) {
    protocol = 'https';
    rest = rest.slice(8);
  } else if (lower.startsWith('http://')) {
    rest = rest.slice(7);
  } else if (lower.startsWith('socks5://')) {
    rest = rest.slice(9);
  } else if (lower.startsWith('socks://')) {
    rest = rest.slice(8);
  }

  const parts = rest.split(':');
  if (parts.length < 2) return null;
  const [host, portRaw, username, ...pwParts] = parts;
  const password = pwParts.length > 0 ? pwParts.join(':') : undefined;
  const port = Number(portRaw);
  if (!host || !isProxyHost(host)) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    protocol,
    host: host.trim(),
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
};
