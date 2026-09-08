import { get, set, del } from 'idb-keyval';

const KEY = 'family-tree:last-gedcom';

export interface StoredGedcom {
  fileName: string;
  text: string;
  importedAt: string;
}

export async function saveLastGedcom(entry: StoredGedcom): Promise<void> {
  try {
    await set(KEY, entry);
  } catch {
    // Storage can fail (private browsing, quota, etc.) - importing still
    // works for the current session, it just won't be remembered.
  }
}

export async function loadLastGedcom(): Promise<StoredGedcom | undefined> {
  try {
    return await get<StoredGedcom>(KEY);
  } catch {
    return undefined;
  }
}

export async function clearLastGedcom(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    // ignore
  }
}
