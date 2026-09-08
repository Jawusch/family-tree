import starterUrl from '../assets/beispiel-stammbaum.ged?url';

/** Name shown in the toolbar for the bundled tree. */
export const STARTER_FILE_NAME = 'beispiel-stammbaum.ged';

/**
 * The example GEDCOM file shipped with the app, used as a starting point
 * when nothing has been imported yet. Names, places and exact dates in it
 * are invented - only the structure and the birth years come from a real
 * tree, so the layout has something realistic to show. It's bundled as an
 * asset (not fetched from a fixed path), so it keeps working when the app
 * is deployed into a subdirectory.
 */
export async function loadStarterGedcom(): Promise<string> {
  const response = await fetch(starterUrl);
  if (!response.ok) throw new Error(`Starter-Datei nicht ladbar (${response.status})`);
  return response.text();
}
