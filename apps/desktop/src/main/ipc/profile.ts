import { IPC_CHANNELS } from '@shared-ipc';
import { MARKET_CURRENCIES, type MarketCurrency, PROTECTED_LABEL_IDS } from '@shared-types';
import { ipcMain } from 'electron';
import {
  type LabelResult,
  createLabel,
  deleteLabel,
  fetchLetters,
  listUserLabels,
  reorderLabels,
  setCurrency,
  updateLabel,
} from '../services/market';
import { handleAction } from './handle-action';

const isCurrency = (v: unknown): v is MarketCurrency =>
  typeof v === 'string' && (MARKET_CURRENCIES as readonly string[]).includes(v);

// Title: non-empty after trim, capped at 16 chars (server also truncates).
const cleanTitle = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, 16) : null;
};

const COLOR_RE =
  /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/;
const cleanColor = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const c = v.trim();
  return COLOR_RE.test(c) ? c : null;
};

const editableTagId = (v: unknown): number | null => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 4) return null;
  return PROTECTED_LABEL_IDS.includes(id) ? null : id;
};

export const registerProfileIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.PROFILE_LABELS_GET, () => listUserLabels());
  ipcMain.handle(IPC_CHANNELS.PROFILE_LABELS_REFRESH, () => listUserLabels({ refresh: true }));

  handleAction(
    IPC_CHANNELS.PROFILE_SET_CURRENCY,
    (_e, payload?: { currency: unknown }) => {
      if (!isCurrency(payload?.currency)) return { ok: false, message: 'invalid_currency' };
      return setCurrency(payload.currency);
    },
    {
      action: 'profile.currency',
      target: (p?: { currency: unknown }) => (isCurrency(p?.currency) ? p.currency : null),
    },
  );

  handleAction(
    IPC_CHANNELS.PROFILE_LABEL_CREATE,
    (_e, payload?: { title: unknown; bc: unknown }): Promise<LabelResult> | LabelResult => {
      const title = cleanTitle(payload?.title);
      const bc = cleanColor(payload?.bc);
      if (!title) return { ok: false, message: 'invalid_title' };
      if (!bc) return { ok: false, message: 'invalid_color' };
      return createLabel(title, bc);
    },
    { action: 'profile.label.create', target: (p?: { title: unknown }) => cleanTitle(p?.title) },
  );

  handleAction(
    IPC_CHANNELS.PROFILE_LABEL_UPDATE,
    (
      _e,
      payload?: { tagId: unknown; title: unknown; bc: unknown },
    ): Promise<LabelResult> | LabelResult => {
      const tagId = editableTagId(payload?.tagId);
      const title = cleanTitle(payload?.title);
      const bc = cleanColor(payload?.bc);
      if (tagId === null) return { ok: false, message: 'invalid_tag' };
      if (!title) return { ok: false, message: 'invalid_title' };
      if (!bc) return { ok: false, message: 'invalid_color' };
      return updateLabel(tagId, title, bc);
    },
    { action: 'profile.label.update', target: (p?: { title: unknown }) => cleanTitle(p?.title) },
  );

  handleAction(
    IPC_CHANNELS.PROFILE_LABEL_DELETE,
    (_e, payload?: { tagId: unknown }): Promise<LabelResult> | LabelResult => {
      const tagId = editableTagId(payload?.tagId);
      if (tagId === null) return { ok: false, message: 'invalid_tag' };
      return deleteLabel(tagId);
    },
    {
      action: 'profile.label.delete',
      target: (p?: { tagId: unknown }) => {
        const id = editableTagId(p?.tagId);
        return id === null ? null : `#${id}`;
      },
    },
  );

  handleAction(
    IPC_CHANNELS.PROFILE_LABEL_REORDER,
    (_e, payload?: { tagIds: unknown }): Promise<LabelResult> | LabelResult => {
      const raw = Array.isArray(payload?.tagIds) ? payload.tagIds : [];
      const tagIds = raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
      if (tagIds.length === 0) return { ok: false, message: 'invalid_order' };
      return reorderLabels(tagIds);
    },
    { action: 'profile.label.reorder' },
  );

  handleAction(
    IPC_CHANNELS.MAIL_GET_LETTERS,
    (
      _e,
      payload?: { emailPassword?: unknown; email?: unknown; password?: unknown; limit?: unknown },
    ) => {
      const str = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim() ? v.trim() : undefined;
      const emailPassword = str(payload?.emailPassword);
      const email = str(payload?.email);
      const password = str(payload?.password);
      if (!emailPassword && !(email && password)) {
        return { ok: false, message: 'invalid_credentials' } as const;
      }
      const limitNum = Number(payload?.limit);
      const limit = Number.isInteger(limitNum) ? Math.min(50, Math.max(10, limitNum)) : undefined;
      return fetchLetters({ emailPassword, email, password, limit });
    },
    {
      action: 'mail.letters',
      detail: (r) => (r.ok ? `${r.letters.length} letters` : null),
    },
  );
};
