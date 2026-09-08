import type { GedcomData } from '../gedcom/types';
import type { GridLayout } from '../gedcom/gridLayout';
import type { TreeSettings } from '../tree/settings';
import type { TileVisuals } from '../tree/tileVisuals';
import { buildExportSvg } from '../tree/exportSvg';

/** jsPDF refuses page dimensions beyond this (the PDF format's own limit). */
const MAX_PAGE_UNITS = 14000;

/**
 * Writes the whole tree to a single-page PDF. The page is drawn as vector
 * graphics - rectangles, lines and real text, not a screenshot - so it stays
 * sharp at any zoom level or print resolution.
 */
export async function exportTreeAsPdf(
  data: GedcomData,
  layout: GridLayout,
  visuals: TileVisuals,
  settings: TreeSettings,
  fileName: string,
): Promise<void> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);

  const { svg, width, height } = buildExportSvg(data, layout, visuals, settings);

  // Very wide trees can exceed what a PDF page may be; scale the drawing
  // down to fit rather than cropping it.
  const scale = Math.min(1, MAX_PAGE_UNITS / width, MAX_PAGE_UNITS / height);
  const pageWidth = Math.round(width * scale);
  const pageHeight = Math.round(height * scale);

  const doc = new jsPDF({
    unit: 'pt',
    orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
    format: [pageWidth, pageHeight],
    compress: true,
  });

  // svg2pdf reads the element's geometry, so it has to be in the document -
  // hidden away off-screen, then removed again.
  svg.style.position = 'fixed';
  svg.style.left = '-100000px';
  svg.style.top = '0';
  document.body.appendChild(svg);
  try {
    await doc.svg(svg, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  } finally {
    svg.remove();
  }

  const base = fileName.replace(/\.ged$/i, '') || 'stammbaum';
  doc.save(`${base}.pdf`);
}
