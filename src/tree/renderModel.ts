import type { GedcomData } from '../gedcom/types';
import type { GridLayout, TilePosition } from '../gedcom/gridLayout';
import type { TreeSettings } from './settings';
import { borderColor } from './settings';
import type { TileVisual, TileVisuals } from './tileVisuals';

/** Everything needed to draw one tile, resolved from the layout, the
 * measured text and the user's colour settings. Both the on-screen SVG and
 * the PDF export draw from this, so the two stay in sync. */
export interface RenderTile {
  pos: TilePosition;
  visual: TileVisual;
  fill: string;
  stroke: string;
  textColor: string;
}

const UNKNOWN_FILL = '#f1f2f4';
const UNKNOWN_TEXT = '#1c1f24';

export function tileColors(sex: string | undefined, settings: TreeSettings): {
  fill: string;
  stroke: string;
  textColor: string;
} {
  const fill = sex === 'M' ? settings.maleFill : sex === 'F' ? settings.femaleFill : UNKNOWN_FILL;
  const textColor = sex === 'M' ? settings.maleText : sex === 'F' ? settings.femaleText : UNKNOWN_TEXT;
  return { fill, stroke: borderColor(fill), textColor };
}

export function buildRenderTiles(
  data: GedcomData,
  layout: GridLayout,
  visuals: TileVisuals,
  settings: TreeSettings,
): RenderTile[] {
  const out: RenderTile[] = [];
  for (const pos of layout.tiles.values()) {
    const person = data.individuals.get(pos.id);
    const visual = visuals.byId.get(pos.id);
    if (!person || !visual) continue;
    out.push({ pos, visual, ...tileColors(person.sex, settings) });
  }
  return out;
}

/** Muted variant of the tile's text colour, used for the year line. */
export function mutedColor(textColor: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(textColor)) return '#6b7280';
  const n = parseInt(textColor.slice(1), 16);
  const mix = (c: number) => Math.round(c + (0x9a - c) * 0.55);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export const CONNECTOR_COLOR = '#9aa1ab';
export const CONNECTOR_WIDTH = 1.5;
export const TILE_RADIUS = 6;
