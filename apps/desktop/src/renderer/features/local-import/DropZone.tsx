import type { LocalImportFile } from '@shared-types';
import { type DragEvent, useRef, useState } from 'react';
import s from './LocalImport.module.scss';

export interface DropZoneProps {
  /** Extensions kept from a drop, lower-case with the dot. */
  extensions?: readonly string[];
  /** `accept` for the hidden input; the picker filters on its own. */
  accept: string;
  multiple?: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onFiles: (files: LocalImportFile[]) => void;
}

const MAX_DEPTH = 8;

const matches = (name: string, extensions: readonly string[]): boolean =>
  extensions.length === 0 || extensions.some((ext) => name.toLowerCase().endsWith(ext));

/** `readEntries` yields at most 100 entries per call, hence the loop. */
const readDir = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const readFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

const collect = async (entry: FileSystemEntry, out: File[], depth: number): Promise<void> => {
  if (entry.isFile) {
    out.push(await readFile(entry as FileSystemFileEntry));
    return;
  }
  if (!entry.isDirectory || depth >= MAX_DEPTH) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await readDir(reader);
    if (batch.length === 0) return;
    for (const child of batch) await collect(child, out, depth + 1);
  }
};

/** Prefers the entries API so a dropped folder is walked, not skipped. */
const filesFromDrop = async (transfer: DataTransfer): Promise<File[]> => {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return [...transfer.files];
  const out: File[] = [];
  for (const entry of entries) await collect(entry, out, 0);
  return out;
};

export const DropZone = ({
  extensions = [],
  accept,
  multiple = true,
  label,
  hint,
  disabled = false,
  onFiles,
}: DropZoneProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = async (files: File[]) => {
    const kept = files.filter((f) => matches(f.name, extensions));
    const read = await Promise.all(kept.map(async (f) => ({ name: f.name, text: await f.text() })));
    onFiles(read);
  };

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    void filesFromDrop(e.dataTransfer).then(take);
  };

  return (
    <>
      <button
        type="button"
        className={`${s.drop} ${over ? s.dropOver : ''}`}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span>{label}</span>
        {hint && <span className={s.dropHint}>{hint}</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        className={s.hiddenInput}
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          // Reset first, so picking the same files twice still fires `change`.
          e.target.value = '';
          void take(picked);
        }}
      />
    </>
  );
};
