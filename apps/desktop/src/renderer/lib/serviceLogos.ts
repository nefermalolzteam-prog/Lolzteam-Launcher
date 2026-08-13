import type { ServiceId } from '@shared-types';
import { SERVICE_ICONS } from '@shared-types';

/** Every icon in `assets/category` is picked up by name. */
const LOGO_URLS = import.meta.glob<string>('../assets/category/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

const LOGO_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_URLS).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.svg'.length),
    url,
  ]),
);

/** Resolves an `icon` name from the registry to its bundled URL. */
export const logoFor = (icon: string | undefined): string | undefined =>
  icon ? LOGO_BY_NAME[icon] : undefined;

/** Convenience wrapper for callers that hold a service id rather than an icon name. */
export const serviceLogo = (id: ServiceId | undefined): string | undefined =>
  id ? logoFor(SERVICE_ICONS[id]) : undefined;
