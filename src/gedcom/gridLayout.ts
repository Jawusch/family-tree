import type { GedcomData } from './types';
import { computeGenerations } from './relations';

export const TILE_WIDTH = 180;
export const TILE_HEIGHT = 60;
const COL_GAP = 30;
const ROW_GAP = 100;
const SLOT = TILE_WIDTH + COL_GAP;

export interface TilePosition {
  id: string;
  generation: number;
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

function parseYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const m = dateStr.match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

/**
 * Lays every individual out on a strict grid: one row per generation, and
 * an x position (in fractional "slot" units) computed the way genealogy
 * charts usually do it - bottom-up, recursively:
 *   - someone with no children of their own gets the next free slot
 *   - a parent is centered exactly over the min/max of their children
 *   - a spouse sits directly beside their partner
 * This keeps children visually underneath their parents instead of being
 * reordered by an independent per-row heuristic.
 */
export function computeGridLayout(data: GedcomData): GridLayout {
  const generations = computeGenerations(data);

  if (data.individualOrder.length === 0) {
    return { tiles: new Map(), connectors: [], width: 800, height: 600 };
  }

  const xOf = new Map<string, number>();
  const familyCenter = new Map<string, number>();
  const visitingFamily = new Set<string>();
  let nextLeaf = 0;

  const setX = (id: string, x: number) => {
    if (!xOf.has(id)) xOf.set(id, x);
  };

  // Chronological ordering (by birth year, falling back to file order)
  // reads more naturally left-to-right and tends to reduce line crossings,
  // similar to how genealogy charts usually lay out siblings and marriages.
  const byYear = (a: string, b: string): number => {
    const ya = parseYear(data.individuals.get(a)?.birth?.date);
    const yb = parseYear(data.individuals.get(b)?.birth?.date);
    if (ya !== undefined && yb !== undefined) return ya - yb;
    if (ya !== undefined) return -1;
    if (yb !== undefined) return 1;
    return 0;
  };

  function layoutPerson(id: string): number {
    const existing = xOf.get(id);
    if (existing !== undefined) return existing;
    if (!data.individuals.has(id)) return nextLeaf++;

    const fams = (data.individuals.get(id)?.fams ?? []).filter((f) => data.families.has(f));
    if (fams.length === 0) {
      const x = nextLeaf++;
      setX(id, x);
      return x;
    }

    // Marriages in chronological order (by first child's birth year, when
    // known) so multiple families fan out left-to-right in a stable order.
    const orderedFams = [...fams].sort((a, b) => {
      const firstChildYear = (f: string) => {
        const kids = data.families.get(f)?.children ?? [];
        const years = kids.map((c) => parseYear(data.individuals.get(c)?.birth?.date)).filter((y): y is number => y !== undefined);
        return years.length ? Math.min(...years) : undefined;
      };
      const ya = firstChildYear(a);
      const yb = firstChildYear(b);
      if (ya !== undefined && yb !== undefined) return ya - yb;
      return 0;
    });

    const centers = orderedFams.map((f) => layoutFamily(f));
    const x = (Math.min(...centers) + Math.max(...centers)) / 2;
    setX(id, x);
    return xOf.get(id)!;
  }

  function layoutFamily(famId: string): number {
    const existing = familyCenter.get(famId);
    if (existing !== undefined) return existing;
    if (visitingFamily.has(famId)) return nextLeaf++; // guard against cyclic/malformed data
    visitingFamily.add(famId);

    const fam = data.families.get(famId)!;
    const kids = fam.children.filter((c) => data.individuals.has(c)).sort(byYear);
    // Only let children who aren't already positioned pull this family's
    // center. A child can already have a position if they were reached via
    // a different branch first (e.g. their spouse's family, when two
    // otherwise-separate family lines are linked by marriage) - letting
    // that foreign position drag this family's parents along would push
    // them into whatever unrelated space that branch already occupies.
    const freshKids = kids.filter((c) => !xOf.has(c));
    const kidXs = freshKids.length > 0 ? freshKids.map((c) => layoutPerson(c)) : [];

    let center: number;
    if (kidXs.length > 0) {
      center = (Math.min(...kidXs) + Math.max(...kidXs)) / 2;
    } else if (kids.length > 0) {
      // Every child here was already positioned via another branch (the
      // cross-branch-marriage case above). We don't get to *centre* over
      // them, but there's no reason to dump this family in a far-off,
      // unrelated leaf slot either - anchor near where those children
      // already ended up instead of grabbing the next arbitrary slot,
      // which otherwise tends to land wherever the rest of the tree
      // happened to reach by that point (often very far away).
      const existingXs = kids.map((c) => xOf.get(c)!);
      center = (Math.min(...existingXs) + Math.max(...existingXs)) / 2;
    } else {
      center = nextLeaf++;
    }
    familyCenter.set(famId, center);

    if (fam.husb && fam.wife) {
      setX(fam.husb, center - 0.5);
      setX(fam.wife, center + 0.5);
    } else if (fam.husb) {
      setX(fam.husb, center);
    } else if (fam.wife) {
      setX(fam.wife, center);
    }

    visitingFamily.delete(famId);
    return center;
  }

  // Process real roots (no known parents) first, chronologically (falling
  // back to name), so the oldest generation reads left-to-right in a
  // stable, predictable order.
  const roots = data.individualOrder
    .filter((id) => !(data.individuals.get(id)?.famc ?? []).some((f) => data.families.has(f)))
    .sort((a, b) => {
      const byBirth = byYear(a, b);
      if (byBirth !== 0) return byBirth;
      return (data.individuals.get(a)?.name ?? '').localeCompare(data.individuals.get(b)?.name ?? '', 'de');
    });
  for (const id of roots) layoutPerson(id);

  // Catch-all for anyone not reached above (disconnected branches, or data
  // quirks where a person's parent family was never visited).
  for (const id of data.individualOrder) layoutPerson(id);

  // --- Resolve any remaining overlaps within a row (naive centering can
  // place unrelated tiles too close together in complex trees). Only ever
  // pushes tiles right, preserving left-to-right order. ---
  const rows = new Map<number, string[]>();
  for (const id of data.individualOrder) {
    const g = generations.get(id) ?? 0;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g)!.push(id);
  }

  const tiles = new Map<string, TilePosition>();
  let maxX = 0;

  // A row's raw x values can occasionally include a huge, meaningless jump:
  // a family with no fresh or anchorable children falls back to "next free
  // leaf slot", whatever that happens to be at that point in the DFS - for
  // a small disconnected fragment reached late (e.g. after deleting the
  // person who used to bridge it to the rest of the tree), that can be
  // hundreds of slots away. So alongside the minimum-gap rule below (never
  // let tiles overlap), also cap the *maximum* gap between two
  // consecutive tiles in the same row - real parent/child centering keeps
  // siblings close together already, so this only ever kicks in for those
  // arbitrary jumps, not for genuinely wide (but connected) families.
  const MAX_GAP = SLOT * 2;

  for (const [g, ids] of rows) {
    const sorted = [...ids].sort((a, b) => xOf.get(a)! - xOf.get(b)!);
    let minAllowed = -Infinity;
    let prevX: number | undefined;
    for (const id of sorted) {
      let x = xOf.get(id)! * SLOT;
      if (prevX !== undefined && x > prevX + MAX_GAP) x = prevX + MAX_GAP;
      if (x < minAllowed) x = minAllowed;
      minAllowed = x + SLOT;
      prevX = x;
      tiles.set(id, { id, generation: g, x, y: g * (TILE_HEIGHT + ROW_GAP) });
      maxX = Math.max(maxX, x);
    }
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
      const maxX2 = Math.max(...allXs);

      const segments = [
        `M ${coupleCenterX} ${parentBottomY} L ${coupleCenterX} ${busY}`,
        `M ${minX} ${busY} L ${maxX2} ${busY}`,
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

  const width = maxX + TILE_WIDTH + 100;
  const height = (rows.size + 1) * (TILE_HEIGHT + ROW_GAP) + 100;

  return { tiles, connectors, width, height };
}
