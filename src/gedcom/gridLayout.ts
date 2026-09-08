import type { GedcomData } from './types';
import { computeGenerations } from './relations';

export const TILE_WIDTH = 180;
export const TILE_HEIGHT = 60;
const COL_GAP = 30;
const ROW_GAP = 100;
const ROW_STEP = TILE_HEIGHT + ROW_GAP;

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

/** Horizontal extent of a subtree at a given generation row. */
interface Extent {
  min: number;
  max: number;
}
type Contour = Map<number, Extent>;

/** A laid-out subtree: its own centre, the row-by-row extent it occupies,
 * and every individual it contains (so shifting it also moves them all). */
interface Bounds {
  centerX: number;
  contour: Contour;
  members: string[];
}

function mergeInto(target: Contour, source: Contour): void {
  for (const [gen, ext] of source) {
    const existing = target.get(gen);
    if (!existing) target.set(gen, { ...ext });
    else {
      existing.min = Math.min(existing.min, ext.min);
      existing.max = Math.max(existing.max, ext.max);
    }
  }
}

function extendRow(contour: Contour, gen: number, min: number, max: number): void {
  const existing = contour.get(gen);
  if (!existing) contour.set(gen, { min, max });
  else {
    existing.min = Math.min(existing.min, min);
    existing.max = Math.max(existing.max, max);
  }
}

/** Minimum rightward shift `incoming` needs so it doesn't overlap `placed`
 * (with at least `gap` between them) at any row they both occupy. */
function computeRequiredShift(placed: Contour, incoming: Contour, gap: number): number {
  let shift = 0;
  for (const [gen, inExt] of incoming) {
    const placedExt = placed.get(gen);
    if (!placedExt) continue;
    const required = placedExt.max + gap - inExt.min;
    if (required > shift) shift = required;
  }
  return shift;
}

/**
 * Lays every individual out on a strict grid: one row per generation. Column
 * position is computed the way classic tree-drawing algorithms do it
 * (Reingold-Tilford / Walker-style, the same idea Graphviz's `dot` engine
 * uses under the hood, which is what tools like Gramps' graph view rely on):
 * bottom-up, each subtree is laid out on its own starting at a local
 * origin, tracking the horizontal extent ("contour") it occupies at every
 * row it spans. Subtrees are then placed left to right, each one shifted
 * just far enough right to clear the previous ones' contour - shifting a
 * subtree moves every individual in it together, so a parent centred over
 * its children never drifts away from them afterwards the way a separate
 * "fix up overlaps per row" pass would.
 */
export function computeGridLayout(data: GedcomData): GridLayout {
  const generations = computeGenerations(data);

  if (data.individualOrder.length === 0) {
    return { tiles: new Map(), connectors: [], width: 800, height: 600 };
  }

  const positions = new Map<string, { x: number; y: number }>();
  const personBoundsCache = new Map<string, Bounds>();
  const familyBoundsCache = new Map<string, Bounds>();
  const visitingFamily = new Set<string>();

  const byYear = (a: string, b: string): number => {
    const ya = parseYear(data.individuals.get(a)?.birth?.date);
    const yb = parseYear(data.individuals.get(b)?.birth?.date);
    if (ya !== undefined && yb !== undefined) return ya - yb;
    if (ya !== undefined) return -1;
    if (yb !== undefined) return 1;
    return 0;
  };

  function shiftBounds(b: Bounds, dx: number): void {
    if (dx === 0) return;
    b.centerX += dx;
    for (const ext of b.contour.values()) {
      ext.min += dx;
      ext.max += dx;
    }
    for (const id of b.members) {
      const p = positions.get(id);
      if (p) p.x += dx;
    }
  }

  /** Places subtrees left to right, shifting each one (and everything in
   * it) just enough to clear the ones already placed. Returns their
   * combined contour. */
  function placeLeftToRight(items: Bounds[]): Contour {
    const combined: Contour = new Map();
    for (const item of items) {
      if (combined.size > 0) {
        const shift = computeRequiredShift(combined, item.contour, COL_GAP);
        if (shift > 0) shiftBounds(item, shift);
      }
      mergeInto(combined, item.contour);
    }
    return combined;
  }

  function layoutPersonBounds(id: string): Bounds {
    const cached = personBoundsCache.get(id);
    if (cached) return cached;

    if (!data.individuals.has(id)) {
      return { centerX: 0, contour: new Map(), members: [] };
    }

    const gen = generations.get(id) ?? 0;
    const person = data.individuals.get(id)!;
    const fams = person.fams.filter((f) => data.families.has(f)).sort((a, b) => {
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

    if (fams.length === 0) {
      // Leaf: no descendants, just their own tile.
      const x = 0;
      positions.set(id, { x, y: gen * ROW_STEP });
      const contour: Contour = new Map([[gen, { min: x, max: x + TILE_WIDTH }]]);
      const bounds: Bounds = { centerX: x + TILE_WIDTH / 2, contour, members: [id] };
      personBoundsCache.set(id, bounds);
      return bounds;
    }

    // Primary (chronologically first) marriage: laid out normally, which
    // fixes this person's own tile position.
    const primaryBounds = layoutFamilyBounds(fams[0]);
    const contour: Contour = new Map(primaryBounds.contour);
    const members: string[] = [...primaryBounds.members];

    // Any further marriages (remarriage) can't go through the usual
    // sibling-style placeLeftToRight against each other, because they all
    // share this same person as a member - shifting one would incorrectly
    // drag someone else's already-fixed tile along with it. Instead, each
    // extra marriage lays out just the *new* spouse and their own
    // descendants (this person stays put), and is pushed clear of every
    // marriage already handled for this person so extra spouses/children
    // don't pile up on top of each other.
    for (let i = 1; i < fams.length; i++) {
      const extra = layoutExtraMarriageBounds(fams[i], id, contour);
      mergeInto(contour, extra.contour);
      members.push(...extra.members);
    }

    const ownPos = positions.get(id);
    const centerX = ownPos ? ownPos.x + TILE_WIDTH / 2 : primaryBounds.centerX;

    const bounds: Bounds = { centerX, contour, members: [...new Set(members)] };
    personBoundsCache.set(id, bounds);
    return bounds;
  }

  /** Lays out one additional marriage (2nd, 3rd, ...) for someone whose
   * primary marriage already fixed their own tile position: places their
   * children as usual, then the *new* spouse next to them, and shifts that
   * whole new-spouse-plus-children bundle clear of `avoidContour`
   * (everything already placed for this person's other marriages). */
  function layoutExtraMarriageBounds(famId: string, anchorId: string, avoidContour: Contour): Bounds {
    const fam = data.families.get(famId)!;
    const newSpouse = fam.husb === anchorId ? fam.wife : fam.husb;
    const allKids = fam.children.filter((c) => data.individuals.has(c)).sort(byYear);
    const freshKids = allKids.filter((c) => !positions.has(c));

    let childrenBoundsList: Bounds[] = [];
    if (freshKids.length > 0) {
      childrenBoundsList = freshKids.map((c) => layoutPersonBounds(c));
      placeLeftToRight(childrenBoundsList);
    }

    const contour: Contour = new Map();
    for (const b of childrenBoundsList) mergeInto(contour, b.contour);

    let centerX: number;
    if (childrenBoundsList.length > 0) {
      centerX = (childrenBoundsList[0].centerX + childrenBoundsList[childrenBoundsList.length - 1].centerX) / 2;
    } else if (allKids.length > 0) {
      const existingXs = allKids.map((c) => positions.get(c)!.x + TILE_WIDTH / 2);
      centerX = (Math.min(...existingXs) + Math.max(...existingXs)) / 2;
    } else {
      centerX = 0;
    }

    const members = childrenBoundsList.flatMap((b) => b.members);
    if (newSpouse && data.individuals.has(newSpouse) && !positions.has(newSpouse)) {
      const gen = Math.max(generations.get(newSpouse) ?? -Infinity, generations.get(anchorId) ?? -Infinity, 0);
      const x = centerX - TILE_WIDTH / 2;
      positions.set(newSpouse, { x, y: gen * ROW_STEP });
      members.push(newSpouse);
      extendRow(contour, gen, x, x + TILE_WIDTH);
    }

    const bounds: Bounds = { centerX, contour, members };
    const shift = computeRequiredShift(avoidContour, bounds.contour, COL_GAP);
    if (shift > 0) shiftBounds(bounds, shift);
    return bounds;
  }

  function layoutFamilyBounds(famId: string): Bounds {
    const cached = familyBoundsCache.get(famId);
    if (cached) return cached;
    if (visitingFamily.has(famId)) return { centerX: 0, contour: new Map(), members: [] };
    visitingFamily.add(famId);

    const fam = data.families.get(famId)!;
    const allKids = fam.children.filter((c) => data.individuals.has(c)).sort(byYear);
    // Only children who aren't already positioned pull this family's
    // centre. A child can already be positioned if they were reached via a
    // different branch first (e.g. their spouse's family, when two
    // otherwise-separate lines are linked by marriage) - letting that
    // foreign position drag this family along would push it into whatever
    // unrelated space that branch already occupies.
    const freshKids = allKids.filter((c) => !positions.has(c));

    let childrenBoundsList: Bounds[] = [];
    if (freshKids.length > 0) {
      childrenBoundsList = freshKids.map((c) => layoutPersonBounds(c));
      placeLeftToRight(childrenBoundsList);
    }

    const contour: Contour = new Map();
    for (const b of childrenBoundsList) mergeInto(contour, b.contour);

    let coupleCenterX: number;
    if (childrenBoundsList.length > 0) {
      coupleCenterX = (childrenBoundsList[0].centerX + childrenBoundsList[childrenBoundsList.length - 1].centerX) / 2;
    } else if (allKids.length > 0) {
      // Every child here was already positioned via another branch -
      // anchor near them instead of an arbitrary, unrelated spot.
      const existingXs = allKids.map((c) => positions.get(c)!.x + TILE_WIDTH / 2);
      coupleCenterX = (Math.min(...existingXs) + Math.max(...existingXs)) / 2;
    } else {
      coupleCenterX = 0;
    }

    const members = childrenBoundsList.flatMap((b) => b.members);
    const husb = fam.husb && data.individuals.has(fam.husb) ? fam.husb : undefined;
    const wife = fam.wife && data.individuals.has(fam.wife) ? fam.wife : undefined;
    // Usually husb and wife share a generation already (computeGenerations
    // aligns spouses whenever it safely can). The one case it deliberately
    // leaves mismatched is two blood descendants of independent lines
    // marrying each other, to avoid breaking either side's sibling group.
    // For *this couple's own row* here, render them together on the later
    // (deeper) of the two - never earlier, so nobody ends up drawn above
    // their own true generation.
    const husbGen = husb ? generations.get(husb) : undefined;
    const wifeGen = wife ? generations.get(wife) : undefined;
    const coupleGen = Math.max(husbGen ?? -Infinity, wifeGen ?? -Infinity, 0);

    if (husb && wife) {
      let husbX = positions.get(husb)?.x;
      let wifeX = positions.get(wife)?.x;
      if (husbX === undefined && wifeX === undefined) {
        husbX = coupleCenterX - TILE_WIDTH - COL_GAP / 2;
        wifeX = husbX + TILE_WIDTH + COL_GAP;
      } else if (husbX === undefined) {
        husbX = coupleCenterX - TILE_WIDTH - COL_GAP / 2;
      } else if (wifeX === undefined) {
        wifeX = coupleCenterX + COL_GAP / 2;
      }
      if (!positions.has(husb)) {
        positions.set(husb, { x: husbX!, y: coupleGen * ROW_STEP });
        members.push(husb);
      }
      if (!positions.has(wife)) {
        positions.set(wife, { x: wifeX!, y: coupleGen * ROW_STEP });
        members.push(wife);
      }
    } else {
      const single = husb ?? wife;
      if (single && !positions.has(single)) {
        positions.set(single, { x: coupleCenterX - TILE_WIDTH / 2, y: coupleGen * ROW_STEP });
        members.push(single);
      }
    }

    const rowXs: number[] = [];
    if (husb && positions.has(husb)) rowXs.push(positions.get(husb)!.x, positions.get(husb)!.x + TILE_WIDTH);
    if (wife && positions.has(wife)) rowXs.push(positions.get(wife)!.x, positions.get(wife)!.x + TILE_WIDTH);
    if (rowXs.length > 0) extendRow(contour, coupleGen, Math.min(...rowXs), Math.max(...rowXs));

    visitingFamily.delete(famId);
    const bounds: Bounds = { centerX: coupleCenterX, contour, members };
    familyBoundsCache.set(famId, bounds);
    return bounds;
  }

  // Process real roots (no known parents) first, chronologically (falling
  // back to name), so the oldest generation reads left-to-right in a
  // stable, predictable order; then anyone left over (disconnected
  // branches, or data quirks) in file order. Both go through the same
  // left-to-right placement as any sibling group.
  const roots = data.individualOrder
    .filter((id) => !(data.individuals.get(id)?.famc ?? []).some((f) => data.families.has(f)))
    .sort((a, b) => {
      const byBirth = byYear(a, b);
      if (byBirth !== 0) return byBirth;
      return (data.individuals.get(a)?.name ?? '').localeCompare(data.individuals.get(b)?.name ?? '', 'de');
    });

  const topLevelBounds: Bounds[] = [];
  for (const id of roots) {
    // A root (no known parents) can still get positioned before we reach
    // them here - e.g. they married into a lineage that was already
    // reached through another, earlier-processed root. Treating them as a
    // *second* independent top-level entry in that case would shift them
    // (and everyone hanging off them) a second time on top of wherever
    // they already correctly ended up.
    if (positions.has(id)) continue;
    topLevelBounds.push(layoutPersonBounds(id));
  }
  for (const id of data.individualOrder) {
    if (positions.has(id) || !data.individuals.has(id)) continue;
    topLevelBounds.push(layoutPersonBounds(id));
  }
  placeLeftToRight(topLevelBounds);

  // --- Collect final tile positions. ---
  const tiles = new Map<string, TilePosition>();
  let maxX = 0;
  let maxGen = 0;
  for (const [id, pos] of positions) {
    // Derive the reported generation from where the tile actually ended up
    // (pos.y is always set as someGeneration * ROW_STEP) rather than
    // re-reading computeGenerations directly - those two can disagree in
    // the rare case of two blood descendants of independent lines
    // marrying, where the couple is deliberately rendered together on the
    // deeper of their two generations; using the real row here keeps the
    // reported generation consistent with what's actually drawn.
    const generation = Math.round(pos.y / ROW_STEP);
    tiles.set(id, { id, generation, x: pos.x, y: pos.y });
    maxX = Math.max(maxX, pos.x);
    maxGen = Math.max(maxGen, generation);
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
      parentBottomY = Math.max(husbPos.y, wifePos.y) + TILE_HEIGHT;

      const gapBetween = rightPos.x - (leftPos.x + TILE_WIDTH);
      if (gapBetween <= COL_GAP + 1) {
        // The usual case: spouses sit right next to each other, so the
        // children's bus drops from the midpoint between them.
        coupleCenterX = (husbPos.x + wifePos.x) / 2 + TILE_WIDTH / 2;
      } else {
        // A remarriage bracket: someone married more than once can only
        // sit tile-adjacent to two of their partners at most, so the
        // others end up further along the row, with other people's tiles
        // in between (the horizontal line still visually connects them,
        // running behind those tiles). The pair's midpoint would then
        // land nowhere near either parent or their actual children, so
        // anchor the bus on whichever parent the children are actually
        // next to instead.
        const childXs = childPositions.map((c) => c.x + TILE_WIDTH / 2);
        const kidsCenter = childXs.length
          ? childXs.reduce((a, b) => a + b, 0) / childXs.length
          : (husbPos.x + wifePos.x) / 2 + TILE_WIDTH / 2;
        const husbCenter = husbPos.x + TILE_WIDTH / 2;
        const wifeCenter = wifePos.x + TILE_WIDTH / 2;
        coupleCenterX = Math.abs(husbCenter - kidsCenter) <= Math.abs(wifeCenter - kidsCenter) ? husbCenter : wifeCenter;
      }
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
  const height = (maxGen + 1) * ROW_STEP + 100;

  return { tiles, connectors, width, height };
}
