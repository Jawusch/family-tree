import { get, set, del } from 'idb-keyval';
import type { SerializedGedcom } from '../gedcom/serialize';

const KEY = 'family-tree:last-gedcom';

export async function saveGedcom(entry: SerializedGedcom): Promise<void> {
  try {
    await set(KEY, entry);
  } catch {
    // Storage can fail (private browsing, quota, etc.) - the app still
    // works for the current session, it just won't be remembered.
  }
}

export async function loadGedcom(): Promise<SerializedGedcom | undefined> {
  try {
    return await get<SerializedGedcom>(KEY);
  } catch {
    return undefined;
  }
}

export async function clearGedcom(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    // ignore
  }
}
