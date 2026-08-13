import { SERVICE_IDS, type ServiceId, getService } from './service-registry';

/** Market category name → service id. */
const NAME_TO_SERVICE: Record<string, ServiceId> = (() => {
  const map: Record<string, ServiceId> = {};
  for (const id of SERVICE_IDS) {
    map[id] = id;
    for (const alias of getService(id).aliases ?? []) map[alias.toLowerCase()] = id;
  }
  return map;
})();

export const categoryNameToServiceId = (name: string | undefined | null): ServiceId | null => {
  if (!name) return null;
  return NAME_TO_SERVICE[name.toLowerCase()] ?? null;
};

/** Service → lzt.market numeric category id, for services that have one. */
export const SERVICE_CATEGORY_ID: Partial<Record<ServiceId, number>> = Object.fromEntries(
  SERVICE_IDS.filter((id) => getService(id).categoryId !== undefined).map((id) => [
    id,
    getService(id).categoryId as number,
  ]),
);

const CATEGORY_ID_TO_SERVICE: Record<number, ServiceId> = Object.fromEntries(
  Object.entries(SERVICE_CATEGORY_ID).map(([service, id]) => [id, service as ServiceId]),
);

export const categoryIdToServiceId = (id: number | undefined | null): ServiceId | null =>
  typeof id === 'number' ? (CATEGORY_ID_TO_SERVICE[id] ?? null) : null;

/** Every market category spelling the launcher recognises. */
export const KNOWN_CATEGORY_NAMES: readonly string[] = Object.keys(NAME_TO_SERVICE);
