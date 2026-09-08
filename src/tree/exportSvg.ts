import type { GedcomData } from '../gedcom/types';
import type { GridLayout } from '../gedcom/gridLayout';
import type { TreeSettings } from './settings';
import type { TileVisuals } from './tileVisuals';
import {
  buildRenderTiles,
  mutedColor,
  CONNECTOR_COLOR,
  CONNECTOR_WIDTH,
  TILE_RADIUS,
} from './renderModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 40;

/**
 * Builds a standalone SVG of the whole tree, cropped to its content and
 * styled entirely through presentation attributes - no stylesheet, no
 * classes, and Helvetica instead of the UI font stack, so a PDF converter
 * reproduces it exactly without needing the page's CSS. Selection state is
 * deliberately left out: an export shows the tree, not the editing state.
 */
export function buildExportSvg(
  data: GedcomData,
  layout: GridLayout,
  visuals: TileVisuals,
  settings: TreeSettings,
): { svg: SVGSVGElement; width: number; height: number } {
  const tiles = buildRenderTiles(data, layout, visuals, settings);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { pos, visual } of tiles) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + visual.width);
    maxY = Math.max(maxY, pos.y + pos.h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = layout.width;
    maxY = layout.height;
  }

  const width = Math.ceil(maxX - minX + 2 * MARGIN);
  const height = Math.ceil(maxY - minY + 2 * MARGIN);
  const offsetX = MARGIN - minX;
  const offsetY = MARGIN - minY;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('x', '0');
  background.setAttribute('y', '0');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff');
  svg.appendChild(background);

  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('transform', `translate(${offsetX}, ${offsetY})`);
  svg.appendChild(root);

  // Connectors first so the parts running behind tiles stay hidden.
  for (const connector of layout.connectors) {
    if (connector.spouseLine) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(connector.spouseLine.x1));
      line.setAttribute('y1', String(connector.spouseLine.y1));
      line.setAttribute('x2', String(connector.spouseLine.x2));
      line.setAttribute('y2', String(connector.spouseLine.y2));
      line.setAttribute('stroke', CONNECTOR_COLOR);
      line.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
      root.appendChild(line);
    }
    if (connector.path) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', connector.path);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', CONNECTOR_COLOR);
      path.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
      root.appendChild(path);
    }
  }

  for (const { pos, visual, fill, stroke, textColor } of tiles) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', String(visual.width));
    rect.setAttribute('height', String(pos.h));
    rect.setAttribute('rx', String(TILE_RADIUS));
    rect.setAttribute('ry', String(TILE_RADIUS));
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', '1.5');
    group.appendChild(rect);

    const muted = mutedColor(textColor);
    for (const line of visual.lines) {
      if (!line.text) continue;
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(visual.width / 2));
      text.setAttribute('y', String(line.y));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'helvetica');
      text.setAttribute('font-size', String(line.fontSize));
      text.setAttribute('font-weight', line.bold ? 'bold' : 'normal');
      text.setAttribute('fill', line.muted ? muted : textColor);
      text.textContent = line.text;
      group.appendChild(text);
    }

    root.appendChild(group);
  }

  return { svg, width, height };
}
