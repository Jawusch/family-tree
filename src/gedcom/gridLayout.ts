import type { GedcomData } from './types';
import { computeGenerations } from './relations';

export const TILE_WIDTH = 180;
export const TILE_HEIGHT = 60;
const COL_GAP = 30;
const ROW_GAP = 100;

export interface TilePosition {
  id: string;
  generation: number;
  column: number;
  x: number;
  y: number;
}

export interface FamilyConnector {
  familyId: string;
  /** Direct horizontal line between two spouses on the same row. */
  spouseLine?: { x1: number; y1: number; x2: number; y2: number };
  /** Orthogonal (horizontal/vertical only) bus connecting parents to children. */
  path?: string;
}

export interface GridLayout {
  tiles: Map<string, TilePosition>;
  connectors: FamilyConnector[];
  width: number;
  height: number;
}

function parentsOf(data: GedcomData, id: string): string[] {
  const person = data.individuals.get(id);
  if (!person) return [];
  const out: string[] = [];
  for (const famId of person.famc) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    if (fam.husb) out.push(fam.husb);
    if (fam.wife) out.push(fam.wife);
  }
  return out;
}

function childrenOf(data: GedcomData, id: string): string[] {
  const person = data.individuals.get(id);
  if (!person) return [];
  const out: string[] = [];
  for (const famId of person.fams) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    out.push(...fam.children);
  }
  return out;
}

function spousesOf(data: GedcomData, id: string): string[] {
  const person = data.individuals.get(id);
  if (!person) return [];
  const out: string[] = [];
  for (const famId of person.fams) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    if (fam.husb && fam.husb !== id) out.push(fam.husb);
    if (fam.wife && fam.wife !== id) out.push(fam.wife);
  }
  return out;
}

/**
 * Lays every individual out on a strict grid: one row per generation,
 * people placed side by side within their row. Column order is seeded by a
 * depth-first walk (so families start out clustered) and then refined with
 * a few barycenter passes against the row above/below to reduce crossings,
 * followed by a pass that pulls spouses back next to each other.
 */
export function computeGridLayout(data: GedcomData): GridLayout {
  const generations = computeGenerations(data);

  const rows = new Map<number, string[]>();
  for (const id of data.individualOrder) {
    const g = generations.get(id) ?? 0;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g)!.push(id);
  }
  const generationList = [...rows.keys()].sort((a, b) => a - b);

  if (generationList.length === 0) {
    return { tiles: new Map(), connectors: [], width: 800, height: 600 };
  }

  // --- Initial ordering via DFS from generation-0 roots. ---
  const order = new Map<number, string[]>();
  for (const g of generationList) order.set(g, []);
  const placed = new Set<string>();

  function place(id: string) {
    if (placed.has(id) || !data.individuals.has(id)) return;
    placed.add(id);
    order.get(generations.get(id) ?? 0)!.push(id);
  }

  function visit(id: string) {
    if (placed.has(id)) return;
    place(id);
    for (const spouse of spousesOf(data, id)) place(spouse);
    for (const child of childrenOf(data, id)) visit(child);
  }

  const roots = [...(rows.get(generationList[0]) ?? [])].sort((a, b) =>
    (data.individuals.get(a)?.name ?? '').localeCompare(data.individuals.get(b)?.name ?? '', 'de'),
  );
  for (const id of roots) visit(id);
  // Anything not reached yet (disconnected branches, data quirks).
  for (const g of generationList) {
    for (const id of rows.get(g)!) visit(id);
  }

  // --- Barycenter passes to reduce crossings. ---
  function reorderPass(direction: 'down' | 'up') {
    const gens = direction === 'down' ? generationList.slice(1) : generationList.slice(0, -1).reverse();
    for (const g of gens) {
      const row = order.get(g)!;
      const neighborRow = order.get(direction === 'down' ? g - 1 : g + 1);
      if (!neighborRow) continue;
      const neighborIndex = new Map(neighborRow.map((id, i) => [id, i]));
      const value = row.map((id, i) => {
        const neighbors = direction === 'down' ? parentsOf(data, id) : childrenOf(data, id);
        const positions = neighbors.map((n) => neighborIndex.get(n)).filter((p): p is number => p !== undefined);
        const v = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : i;
        return { id, i, v };
      });
      value.sort((a, b) => a.v - b.v || a.i - b.i);
      order.set(g, value.map((e) => e.id));
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    reorderPass('down');
    reorderPass('up');
  }

  // Pull spouses back next to each other.
  for (const g of generationList) {
    const row = order.get(g)!;
    for (let i = 0; i < row.length; i++) {
      const id = row[i];
      for (const spouseId of spousesOf(data, id)) {
        const spouseIdx = row.indexOf(spouseId);
        if (spouseIdx === -1 || spouseIdx === i + 1) continue;
        row.splice(spouseIdx, 1);
        const newI = row.indexOf(id);
        row.splice(newI + 1, 0, spouseId);
      }
    }
  }

  // --- Assign pixel positions. ---
  const tiles = new Map<string, TilePosition>();
  let maxColumns = 0;
  for (const g of generationList) {
    const row = order.get(g)!;
    maxColumns = Math.max(maxColumns, row.length);
    row.forEach((id, col) => {
      tiles.set(id, {
        id,
        generation: g,
        column: col,
        x: col * (TILE_WIDTH + COL_GAP),
        y: g * (TILE_HEIGHT + ROW_GAP),
      });
    });
  }

  // --- Orthogonal family connectors (spouse line + parent/child bus). ---
  const connectors: FamilyConnector[] = [];
  for (const fam of data.families.values()) {
    const husbPos = fam.husb ? tiles.get(fam.husb) : undefined;
    const wifePos = fam.wife ? tiles.get(fam.wife) : undefined;
    const childPositions = fam.children.map((c) => tiles.get(c)).filter((p): p is TilePosition => !!p);

    let coupleCenterX: number | undefined;
    let parentBottomY: number | undefined;
    let spouseLine: FamilyConnector['spouseLine'];

    if (husbPos && wifePos) {
      const [leftPos, rightPos] = husbPos.x <= wifePos.x ? [husbPos, wifePos] : [wifePos, husbPos];
      const y = leftPos.y + TILE_HEIGHT / 2;
      spouseLine = { x1: leftPos.x + TILE_WIDTH, y1: y, x2: rightPos.x, y2: y };
      coupleCenterX = (husbPos.x + wifePos.x) / 2 + TILE_WIDTH / 2;
      parentBottomY = Math.max(husbPos.y, wifePos.y) + TILE_HEIGHT;
    } else if (husbPos || wifePos) {
      const p = (husbPos ?? wifePos)!;
      coupleCenterX = p.x + TILE_WIDTH / 2;
      parentBottomY = p.y + TILE_HEIGHT;
    }

    let path: string | undefined;
    if (coupleCenterX !== undefined && parentBottomY !== undefined && childPositions.length > 0) {
      const busY = parentBottomY + ROW_GAP / 2;
      const childXs = childPositions.map((c) => c.x + TILE_WIDTH / 2);
      const allXs = [coupleCenterX, ...childXs];
      const minX = Math.min(...allXs);
      const maxX = Math.max(...allXs);

      const segments = [
        `M ${coupleCenterX} ${parentBottomY} L ${coupleCenterX} ${busY}`,
        `M ${minX} ${busY} L ${maxX} ${busY}`,
        ...childPositions.map((c) => {
          const cx = c.x + TILE_WIDTH / 2;
          return `M ${cx} ${busY} L ${cx} ${c.y}`;
        }),
      ];
      path = segments.join(' ');
    }

    if (spouseLine || path) {
      connectors.push({ familyId: fam.id, spouseLine, path });
    }
  }

  const width = (maxColumns + 1) * (TILE_WIDTH + COL_GAP) + 100;
  const height = (generationList.length + 1) * (TILE_HEIGHT + ROW_GAP) + 100;

  return { tiles, connectors, width, height };
}
