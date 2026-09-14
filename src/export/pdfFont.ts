import type { jsPDF } from 'jspdf';
import robotoRegularUrl from '../assets/fonts/Roboto-Regular.ttf?url';
import robotoMediumUrl from '../assets/fonts/Roboto-Medium.ttf?url';

/** Name the embedded font is registered under inside the PDF. */
export const EMBEDDED_FONT = 'Roboto';

/** What the PDF format's built-in fonts can write: the printable ASCII
 * range, the Western European range, and the handful of extras Windows-1252
 * adds in between (dashes, quotes, the ellipsis). */
const WINDOWS_1252_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function writableWithBuiltInFont(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const known =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WINDOWS_1252_EXTRAS.includes(char);
    if (!known) return false;
  }
  return true;
}

/**
 * Whether the tree contains text the built-in PDF fonts cannot write.
 *
 * Those fonts only cover Western European characters. A name like
 * "Pestiček" falls outside that, and it doesn't merely lose the accent -
 * the whole name is written in a form the built-in font has no way to
 * render, so it comes out blank. Such a file needs a real font embedded.
 */
export function needsEmbeddedFont(texts: Iterable<string>): boolean {
  for (const text of texts) {
    if (!writableWithBuiltInFont(text)) return true;
  }
  return false;
}

async function loadAsBase64(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let binary = '';
  // In chunks: a whole font passed to fromCharCode at once blows the stack.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Puts a font covering the whole Latin range into the document. Fetched
 * only at this point, so a tree that the built-in fonts can write never
 * downloads it.
 */
export async function embedUnicodeFont(doc: jsPDF): Promise<void> {
  const [regular, medium] = await Promise.all([
    loadAsBase64(robotoRegularUrl),
    loadAsBase64(robotoMediumUrl),
  ]);
  doc.addFileToVFS('Roboto-Regular.ttf', regular);
  doc.addFont('Roboto-Regular.ttf', EMBEDDED_FONT, 'normal');
  doc.addFileToVFS('Roboto-Medium.ttf', medium);
  doc.addFont('Roboto-Medium.ttf', EMBEDDED_FONT, 'bold');
}
