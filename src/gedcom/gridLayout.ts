import type { Family, GedcomData } from './types';
import { computeGenerations } from './relations';

export const TILE_WIDTH = 180;
export const TILE_HEIGHT = 60;
const COL_GAP = 30;
const ROW_GAP = 100;

/** Tile dimensions the layout should work with. Widths can differ per
 * person (auto-sized tiles), the height is uniform so rows stay aligned. */
export interface LayoutMetrics {
  widthOf: (id: string) => number;
  defaultWidth: number;
  height: number;
}

const DEFAULT_METRICS: LayoutMetrics = {
  widthOf: () => TILE_WIDTH,
  defaultWidth: TILE_WIDTH,
  height: TILE_HEIGHT,
};

export interface TilePosition {
  id: string;
  generation: number;
  x: number;
  y: number;
  w: number;
  h: number;
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

/** The position closest to `idealLeft` where a block `width` wide fits into
 * a row without coming within `gap` of anything already sitting there. */
function fitBlock(idealLeft: number, width: number, occupied: Extent[], gap = COL_GAP): number {
  const clear = (x: number) =>
    occupied.every((t) => x + width + gap <= t.min + 0.5 || x >= t.max + gap - 0.5);
  if (clear(idealLeft)) return idealLeft;

  let best: number | undefined;
  for (const t of occupied) {
    // Flush against either side of whatever is in the way.
    for (const candidate of [t.max + gap, t.min - gap - width]) {
      if (!clear(candidate)) continue;
      if (best === undefined || Math.abs(candidate - idealLeft) < Math.abs(best - idealLeft)) {
        best = candidate;
      }
    }
  }
  return best ?? idealLeft;
}

/** Space kept between the drawing and the edge of the canvas. */
const CANVAS_MARGIN = 50;

/** How far apart two families' child lines have to be before they may share
 * a height without reading as one continuous line. */
const BUS_CLEARANCE = COL_GAP;

const CORNER_RADIUS = 8;

/** Builds an SVG path through `points` (each consecutive pair horizontal or
 * vertical) with each interior 90° turn softened into a small rounded
 * corner, instead of a sharp elbow. */
function roundedPath(points: { x: number; y: number }[], radius = CORNER_RADIUS): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y) || 1;
    const r1 = Math.min(radius, inLen / 2);
    const r2 = Math.min(radius, outLen / 2);
    const approachX = curr.x - ((curr.x - prev.x) / inLen) * r1;
    const approachY = curr.y - ((curr.y - prev.y) / inLen) * r1;
    const departX = curr.x + ((next.x - curr.x) / outLen) * r2;
    const departY = curr.y + ((next.y - curr.y) / outLen) * r2;
    d += ` L ${approachX} ${approachY} Q ${curr.x} ${curr.y} ${departX} ${departY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
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
function layoutOnce(
  data: GedcomData,
  metrics: LayoutMetrics,
  childOrder: Map<string, string[]> | undefined,
): { layout: GridLayout; crossings: number } {
  const generations = computeGenerations(data);

  if (data.individualOrder.length === 0) {
    return { layout: { tiles: new Map(), connectors: [], width: 800, height: 600 }, crossings: 0 };
  }

  const tileH = metrics.height;
  const rowStep = tileH + ROW_GAP;
  /** Width of one person's tile. */
  const wOf = (id: string | undefined): number =>
    (id ? metrics.widthOf(id) : undefined) ?? metrics.defaultWidth;

  const positions = new Map<string, { x: number; y: number }>();
  const personBoundsCache = new Map<string, Bounds>();
  const familyBoundsCache = new Map<string, Bounds>();
  const visitingFamily = new Set<string>();
  const anchoredFamilies = new Set<string>();
  /** Which family "owns" (was the one to actually set) a given
   * individual's x position - used so the re-anchoring pass below only
   * ever moves someone their own family is authoritative for. */
  const ownedBy = new Map<string, string>();

  const byYear = (a: string, b: string): number => {
    const ya = parseYear(data.individuals.get(a)?.birth?.date);
    const yb = parseYear(data.individuals.get(b)?.birth?.date);
    if (ya !== undefined && yb !== undefined) return ya - yb;
    if (ya !== undefined) return -1;
    if (yb !== undefined) return 1;
    return 0;
  };

  /** A family's children, oldest first - unless a previous round worked
   * out an order that leaves fewer lines crossing. */
  const orderedChildren = (fam: Family): string[] => {
    const kids = fam.children.filter((c) => data.individuals.has(c));
    const preferred = childOrder?.get(fam.id);
    if (!preferred) return kids.sort(byYear);
    const rank = new Map(preferred.map((id, i) => [id, i]));
    return kids.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
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
      positions.set(id, { x, y: gen * rowStep });
      const contour: Contour = new Map([[gen, { min: x, max: x + wOf(id) }]]);
      const bounds: Bounds = { centerX: x + wOf(id) / 2, contour, members: [id] };
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
    const centerX = ownPos ? ownPos.x + wOf(id) / 2 : primaryBounds.centerX;

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
    const allKids = orderedChildren(fam);
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
      const existingXs = allKids.map((c) => positions.get(c)!.x + wOf(c) / 2);
      centerX = (Math.min(...existingXs) + Math.max(...existingXs)) / 2;
    } else {
      centerX = 0;
    }

    const members = childrenBoundsList.flatMap((b) => b.members);
    if (newSpouse && data.individuals.has(newSpouse) && !positions.has(newSpouse)) {
      const gen = Math.max(generations.get(newSpouse) ?? -Infinity, generations.get(anchorId) ?? -Infinity, 0);
      const x = centerX - wOf(newSpouse) / 2;
      positions.set(newSpouse, { x, y: gen * rowStep });
      members.push(newSpouse);
      extendRow(contour, gen, x, x + wOf(newSpouse));
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
    const allKids = orderedChildren(fam);
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
      // anchor near them instead of an arbitrary, unrelated spot. That
      // anchor is only a snapshot, though: the branch that positioned
      // them can still get shifted again later on its own (unrelated)
      // top-level entry, since these parents were never part of it and so
      // don't move along - tracked for a final re-anchoring pass once
      // every shift in the whole tree is done.
      const existingXs = allKids.map((c) => positions.get(c)!.x + wOf(c) / 2);
      coupleCenterX = (Math.min(...existingXs) + Math.max(...existingXs)) / 2;
      anchoredFamilies.add(famId);
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
      // Remember which of the two (if any) this family is actually the
      // one setting, *before* setting it - a re-anchoring pass later must
      // only ever move the spouse this family itself owns, never one
      // that's already positioned (and authoritative) elsewhere.
      if (husbX === undefined) ownedBy.set(husb, famId);
      if (wifeX === undefined) ownedBy.set(wife, famId);
      if (husbX === undefined && wifeX === undefined) {
        husbX = coupleCenterX - wOf(husb) - COL_GAP / 2;
        wifeX = husbX + wOf(husb) + COL_GAP;
      } else if (husbX === undefined) {
        husbX = coupleCenterX - wOf(husb) - COL_GAP / 2;
      } else if (wifeX === undefined) {
        wifeX = coupleCenterX + COL_GAP / 2;
      }
      if (!positions.has(husb)) {
        positions.set(husb, { x: husbX!, y: coupleGen * rowStep });
        members.push(husb);
      }
      if (!positions.has(wife)) {
        positions.set(wife, { x: wifeX!, y: coupleGen * rowStep });
        members.push(wife);
      }
    } else {
      const single = husb ?? wife;
      if (single && !positions.has(single)) {
        ownedBy.set(single, famId);
        positions.set(single, { x: coupleCenterX - wOf(single) / 2, y: coupleGen * rowStep });
        members.push(single);
      }
    }

    const rowXs: number[] = [];
    if (husb && positions.has(husb)) rowXs.push(positions.get(husb)!.x, positions.get(husb)!.x + wOf(husb));
    if (wife && positions.has(wife)) rowXs.push(positions.get(wife)!.x, positions.get(wife)!.x + wOf(wife));
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

  // Anchored families (positioned near children who turned out to already
  // be placed via a different branch - e.g. married into another root's
  // family tree, or, for someone with no descendants of their own beyond a
  // childless marriage, simply reached through their spouse's independent
  // root before their own parents got a chance to place them as a child)
  // only had a snapshot of that branch's position to work with. If that
  // branch was on a *different* top-level entry, it can have been shifted
  // again since - these parents were never one of its members and so
  // never moved along. Re-centre each one now that every shift in the
  // whole tree has actually happened. A few passes since re-centring one
  // anchored family can itself move the anchor a rarer, nested case
  // depends on.
  for (let pass = 0; pass < 3; pass++) {
    for (const famId of anchoredFamilies) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      const kids = fam.children.filter((c) => data.individuals.has(c) && positions.has(c));
      if (kids.length === 0) continue;
      const xs = kids.map((c) => positions.get(c)!.x + wOf(c) / 2);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;

      // Only move the spouse(s) this family actually owns - one of them
      // can easily be someone already (and authoritatively) positioned by
      // their own, different family, like Helga above, who must never be
      // dragged along just because *her* husband's remarriage needed
      // re-centring.
      const ownedHusb = fam.husb && ownedBy.get(fam.husb) === famId ? fam.husb : undefined;
      const ownedWife = fam.wife && ownedBy.get(fam.wife) === famId ? fam.wife : undefined;
      if (!ownedHusb && !ownedWife) continue;

      // The spouses this family owns are re-placed as one block, into the
      // nearest gap that actually has room for them. Dropping each of them
      // separately onto the children's midpoint reads badly whenever a
      // neighbouring couple centres on the very next child: the two pairs
      // interleave, and each marriage line then has to reach across the
      // other couple's tile, leaving two lines stacked in the same row.
      const row = Math.round(positions.get(ownedHusb ?? ownedWife!)!.y / rowStep);
      const occupied: Extent[] = [];
      for (const [id, p] of positions) {
        if (id === ownedHusb || id === ownedWife) continue;
        if (Math.round(p.y / rowStep) === row) occupied.push({ min: p.x, max: p.x + wOf(id) });
      }

      const blockWidth =
        ownedHusb && ownedWife
          ? wOf(ownedHusb) + COL_GAP + wOf(ownedWife)
          : wOf(ownedHusb ?? ownedWife);
      const left = fitBlock(centerX - blockWidth / 2, blockWidth, occupied);

      if (ownedHusb) positions.get(ownedHusb)!.x = left;
      if (ownedWife) positions.get(ownedWife)!.x = ownedHusb ? left + wOf(ownedHusb) + COL_GAP : left;
    }
  }

  // The re-anchoring above recomputes a position from scratch, bypassing
  // the original construction's collision avoidance - so it can land
  // exactly on top of unrelated content. Nothing else in the tree depends
  // on exactly where an anchored family's owned spouse(s) end up (their
  // only child(ren) are already positioned independently of them), so it's
  // safe to nudge *just those* tiles clear of whatever they now overlap,
  // without moving anyone else (who might have real dependents relying on
  // their exact position).
  const rowsForSafety = new Map<number, string[]>();
  for (const [id, pos] of positions) {
    const gen = Math.round(pos.y / rowStep);
    if (!rowsForSafety.has(gen)) rowsForSafety.set(gen, []);
    rowsForSafety.get(gen)!.push(id);
  }
  for (const ids of rowsForSafety.values()) {
    const sorted = [...ids].sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevX = positions.get(prev)!.x;
      const currX = positions.get(curr)!.x;
      const gap = currX - (prevX + wOf(prev));
      if (gap >= COL_GAP) continue;
      const deficit = COL_GAP - gap;
      if (ownedBy.has(curr)) {
        positions.get(curr)!.x = currX + deficit;
      } else if (ownedBy.has(prev)) {
        positions.get(prev)!.x = prevX - deficit;
      }
    }
  }

  // --- Collect final tile positions. ---
  const tiles = new Map<string, TilePosition>();
  let maxX = 0;
  let maxGen = 0;
  for (const [id, pos] of positions) {
    // Derive the reported generation from where the tile actually ended up
    // (pos.y is always set as someGeneration * rowStep) rather than
    // re-reading computeGenerations directly - those two can disagree in
    // the rare case of two blood descendants of independent lines
    // marrying, where the couple is deliberately rendered together on the
    // deeper of their two generations; using the real row here keeps the
    // reported generation consistent with what's actually drawn.
    const generation = Math.round(pos.y / rowStep);
    tiles.set(id, { id, generation, x: pos.x, y: pos.y, w: wOf(id), h: tileH });
    maxX = Math.max(maxX, pos.x + wOf(id));
    maxGen = Math.max(maxGen, generation);
  }

  interface ConnectorResult {
    connectors: FamilyConnector[];
    /** How often a line going down crosses another family's line. */
    crossings: number;
    /** How far everyone sits from what they are attached to. Only used to
     * break ties between arrangements with the same number of conflicts,
     * where it pulls families together. */
    length: number;
  }

  // Every connector follows from the tile positions alone, so the whole lot
  // can be rebuilt to score an arrangement that the ordering pass below
  // wants to try out.
  // Scoring a trial arrangement needs the geometry but not the finished
  // SVG paths, which are by far the most expensive part to produce - so
  // those are only built for the arrangement that is actually kept.
  function buildConnectors(withPaths = true): ConnectorResult {
    // Marriage lines run horizontally through the row itself, at the tiles'
    // own vertical middle - the parts that pass behind a tile are hidden
    // (connectors are drawn underneath the tiles), so what's visible are the
    // segments crossing the gaps between them. A line never leaves the row's
    // band, so it can't be mistaken for a line going down to children.
    //
    // Once someone has married more than once they can only sit tile-adjacent
    // to two of their partners, so the remaining lines have to reach past
    // other people's tiles. Where two such lines in the same row would
    // genuinely run into each other, the later ones get their own slightly
    // lower height *within* the row band, so it stays clear which line
    // belongs to which marriage. Lines that merely meet at a shared spouse
    // aren't a conflict - they read as one line running through that person.
    interface MarriageSpan {
      famId: string;
      row: number;
      start: number;
      end: number;
    }
    const spans: MarriageSpan[] = [];
    for (const fam of data.families.values()) {
      const h = fam.husb ? tiles.get(fam.husb) : undefined;
      const w = fam.wife ? tiles.get(fam.wife) : undefined;
      if (!h || !w) continue;
      const hc = h.x + h.w / 2;
      const wc = w.x + w.w / 2;
      spans.push({ famId: fam.id, row: h.generation, start: Math.min(hc, wc), end: Math.max(hc, wc) });
    }

    const tilesInRow = new Map<number, TilePosition[]>();
    for (const tile of tiles.values()) {
      if (!tilesInRow.has(tile.generation)) tilesInRow.set(tile.generation, []);
      tilesInRow.get(tile.generation)!.push(tile);
    }

    const laneOf = new Map<string, number>();
    const laneStepInRow = new Map<number, number>();
    const spansByRow = new Map<number, MarriageSpan[]>();
    for (const span of spans) {
      if (!spansByRow.has(span.row)) spansByRow.set(span.row, []);
      spansByRow.get(span.row)!.push(span);
    }
    for (const [row, rowSpans] of spansByRow) {
      // Shortest first, so a long line reaching past other tiles is the one
      // that gives way, not the neighbouring couples sitting side by side.
      rowSpans.sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start));
      const lanes: MarriageSpan[][] = [];
      for (const span of rowSpans) {
        let lane = 0;
        // Overlapping only counts when the spans genuinely cross, not when
        // they meet at a shared spouse - hence the small tolerance.
        while (lanes[lane]?.some((other) => span.start < other.end - 1 && other.start < span.end - 1)) lane++;
        (lanes[lane] ??= []).push(span);
        laneOf.set(span.famId, lane);
      }
      // Fit all of this row's lanes into the lower half of the tile band, so
      // even the deepest one still ends comfortably inside the tiles.
      const maxLane = lanes.length - 1;
      laneStepInRow.set(row, maxLane > 0 ? Math.min(10, Math.max(2, tileH / 2 - 8) / maxLane) : 0);
    }

    // --- Orthogonal family connectors (spouse line + parent/child bus). ---
    // Worked out in two steps: first what each family needs, then - once
    // every family in a row is known - at which height each one's line to its
    // children runs, so that two families' lines never merge into one.
    interface ConnectorPlan {
      famId: string;
      spouseLine?: FamilyConnector['spouseLine'];
      dropX?: number;
      dropY?: number;
      children: TilePosition[];
      parentY: number;
      parentRow: number;
      busStart: number;
      busEnd: number;
    }

    const plans: ConnectorPlan[] = [];
    for (const fam of data.families.values()) {
      const husbPos = fam.husb ? tiles.get(fam.husb) : undefined;
      const wifePos = fam.wife ? tiles.get(fam.wife) : undefined;
      const childPositions = fam.children.map((c) => tiles.get(c)).filter((p): p is TilePosition => !!p);

      let spouseLine: FamilyConnector['spouseLine'];
      // Where the children's line leaves the marriage line.
      let dropX: number | undefined;
      let dropY: number | undefined;

      if (husbPos && wifePos) {
        const [leftPos, rightPos] = husbPos.x <= wifePos.x ? [husbPos, wifePos] : [wifePos, husbPos];
        const leftCx = leftPos.x + leftPos.w / 2;
        const rightCx = rightPos.x + rightPos.w / 2;
        const lane = laneOf.get(fam.id) ?? 0;
        const step = laneStepInRow.get(leftPos.generation) ?? 0;
        // Straight through the row, tile centre to tile centre - the parts
        // behind tiles are hidden, so it shows up in the gaps between them.
        const y = leftPos.y + tileH / 2 + lane * step;
        spouseLine = { x1: leftCx, y1: y, x2: rightCx, y2: y };
        dropY = y;

        // For a couple standing side by side, the line to their children
        // leaves from the middle of the gap between their two tiles - the
        // one stretch of their marriage line that is actually visible, and
        // where it reads as belonging to both of them equally. Taking the
        // midpoint between the two tile centres instead lands slightly off
        // whenever the two tiles are not the same width.
        const leftEdge = leftPos.x + leftPos.w;
        const sideBySide = rightPos.x - leftEdge <= COL_GAP + 0.5;

        // Where the couple is not side by side - a remarriage, with other
        // tiles or empty space between them - the line leaves from the
        // point above the children instead, so it does not first run back
        // across somebody else's family before heading down.
        const childCenters = childPositions.map((c) => c.x + c.w / 2);
        const overChildren = childCenters.length
          ? (Math.min(...childCenters) + Math.max(...childCenters)) / 2
          : (leftCx + rightCx) / 2;
        let drop = sideBySide
          ? (leftEdge + rightPos.x) / 2
          : Math.min(Math.max(overChildren, leftCx), rightCx);

        // A line going down has to branch off a *visible* piece of the
        // marriage line, never straight out of someone's tile - the
        // downward line stands for "children of this couple", so it has to
        // be seen leaving the connection between them. Where the point over
        // the children falls behind a tile (a remarriage puts the children
        // right under one partner), step into the gap beside that tile,
        // towards the rest of the line.
        const blocking = (tilesInRow.get(leftPos.generation) ?? []).find(
          (t) => drop > t.x - 0.5 && drop < t.x + t.w + 0.5,
        );
        if (blocking) {
          const inGapLeft = blocking.x - COL_GAP / 2;
          const inGapRight = blocking.x + blocking.w + COL_GAP / 2;
          const fits = (x: number) => x >= leftCx - 0.5 && x <= rightCx + 0.5;
          // Prefer the gap on the side the rest of the line runs off to.
          const preferLeft = drop - leftCx > rightCx - drop;
          const first = preferLeft ? inGapLeft : inGapRight;
          const second = preferLeft ? inGapRight : inGapLeft;
          if (fits(first)) drop = first;
          else if (fits(second)) drop = second;
        }
        dropX = drop;
      } else if (husbPos || wifePos) {
        // A lone parent has no marriage line to branch off, so the line
        // starts at the bottom edge of their tile.
        const p = (husbPos ?? wifePos)!;
        dropX = p.x + p.w / 2;
        dropY = p.y + tileH;
      }

      const parent = husbPos ?? wifePos;
      const childCenters = childPositions.map((c) => c.x + c.w / 2);
      const busPoints = dropX !== undefined ? [dropX, ...childCenters] : childCenters;

      plans.push({
        famId: fam.id,
        spouseLine,
        dropX,
        dropY,
        children: childPositions,
        parentY: parent?.y ?? 0,
        parentRow: parent?.generation ?? 0,
        busStart: busPoints.length ? Math.min(...busPoints) : 0,
        busEnd: busPoints.length ? Math.max(...busPoints) : 0,
      });
    }

    // Each family's children hang off a horizontal line in the gap below
    // their parents. Drawing every family in a row at the same height makes
    // neighbouring families' lines run into each other wherever their
    // children sit interleaved - which happens as soon as two children of
    // different families marry and are placed side by side - and the result
    // reads as one line, as if all of those children belonged to one couple.
    // So the lines of a row are spread across the gap: two that would touch
    // get their own height, and only lines that are clearly apart share one.
    const busYOf = new Map<string, number>();
    const plansByRow = new Map<number, ConnectorPlan[]>();
    for (const plan of plans) {
      if (plan.children.length === 0 || plan.dropX === undefined) continue;
      if (!plansByRow.has(plan.parentRow)) plansByRow.set(plan.parentRow, []);
      plansByRow.get(plan.parentRow)!.push(plan);
    }

    for (const rowPlans of plansByRow.values()) {
      // A family whose line has no horizontal part at all (a single child
      // straight below the drop point) can't merge with anything, so it
      // doesn't take up one of the heights.
      const spanning = rowPlans.filter((p) => p.busEnd - p.busStart > 1);
      // Narrow lines first: they settle nearest the parents, leaving the
      // wide ones closest to the children, where their many downward
      // branches are short and cross the least.
      spanning.sort((a, b) => a.busEnd - a.busStart - (b.busEnd - b.busStart) || a.busStart - b.busStart);

      const lanes: ConnectorPlan[][] = [];
      const laneOfBus = new Map<string, number>();
      for (const plan of spanning) {
        let lane = 0;
        while (
          lanes[lane]?.some(
            (other) =>
              plan.busStart < other.busEnd + BUS_CLEARANCE && other.busStart < plan.busEnd + BUS_CLEARANCE,
          )
        ) {
          lane++;
        }
        (lanes[lane] ??= []).push(plan);
        laneOfBus.set(plan.famId, lane);
      }

      const step = ROW_GAP / (Math.max(1, lanes.length) + 1);
      for (const plan of rowPlans) {
        const lane = laneOfBus.get(plan.famId);
        const offset = lane === undefined ? ROW_GAP / 2 : step * (lane + 1);
        busYOf.set(plan.famId, plan.parentY + tileH + offset);
      }
    }

    const connectors: FamilyConnector[] = [];
    for (const plan of withPaths ? plans : []) {
      const { dropX, dropY } = plan;
      let path: string | undefined;
      if (dropX !== undefined && dropY !== undefined && plan.children.length > 0) {
        const busY = busYOf.get(plan.famId) ?? plan.parentY + tileH + ROW_GAP / 2;
        const childPaths = plan.children.map((c) => {
          const cx = c.x + c.w / 2;
          return roundedPath([
            { x: dropX, y: dropY },
            { x: dropX, y: busY },
            { x: cx, y: busY },
            { x: cx, y: c.y },
          ]);
        });
        path = childPaths.filter(Boolean).join(' ');
      }

      if (plan.spouseLine || path) {
        connectors.push({ familyId: plan.famId, spouseLine: plan.spouseLine, path });
      }
    }

    // Score this arrangement: how often two families' lines get in each
    // other's way in the gap between two rows. The parts inside the tile
    // band are hidden behind the tiles, so only the gap counts.
    const verticals: { famId: string; x: number; top: number; bottom: number }[] = [];
    const horizontals: { famId: string; y: number; left: number; right: number }[] = [];
    let length = 0;
    for (const plan of plans) {
      if (plan.dropX === undefined || plan.children.length === 0) continue;
      const busY = busYOf.get(plan.famId) ?? plan.parentY + tileH + ROW_GAP / 2;
      const tileBottom = plan.parentY + tileH;
      length += Math.abs(busY - tileBottom);

      // A child sitting straight below the drop point is reached by one
      // unbroken line from the parents, not by two segments meeting halfway
      // - which matters for working out what that line runs into.
      let dropDrawnStraightDown = false;
      for (const child of plan.children) {
        const cx = child.x + child.w / 2;
        const straightDown = Math.abs(cx - plan.dropX) < 0.5;
        if (straightDown) dropDrawnStraightDown = true;
        verticals.push({ famId: plan.famId, x: cx, top: straightDown ? tileBottom : busY, bottom: child.y });
        length += Math.abs(child.y - busY) + Math.abs(cx - plan.dropX);
      }
      if (!dropDrawnStraightDown) {
        verticals.push({ famId: plan.famId, x: plan.dropX, top: tileBottom, bottom: busY });
      }
      horizontals.push({ famId: plan.famId, y: busY, left: plan.busStart, right: plan.busEnd });
    }
    for (const plan of plans) {
      if (plan.spouseLine) length += Math.abs(plan.spouseLine.x2 - plan.spouseLine.x1);
    }

    // Touching counts the same as crossing: a line ending exactly on
    // another family's line reads as a junction between the two, which
    // claims a relationship that isn't there.
    let crossings = 0;
    for (const v of verticals) {
      for (const h of horizontals) {
        if (v.famId === h.famId) continue;
        if (v.x >= h.left - 0.5 && v.x <= h.right + 0.5 && h.y >= v.top - 0.5 && h.y <= v.bottom + 0.5) {
          crossings++;
        }
      }
    }
    // Two downward lines sharing a column merge into one just as badly.
    const byColumn = new Map<number, typeof verticals>();
    for (const v of verticals) {
      const column = Math.round(v.x);
      if (!byColumn.has(column)) byColumn.set(column, []);
      byColumn.get(column)!.push(v);
    }
    for (const column of byColumn.values()) {
      for (let i = 0; i < column.length; i++) {
        for (let j = i + 1; j < column.length; j++) {
          if (column[i].famId === column[j].famId) continue;
          const overlap =
            Math.min(column[i].bottom, column[j].bottom) - Math.max(column[i].top, column[j].top);
          if (overlap >= -0.5) crossings++;
        }
      }
    }

    return { connectors, crossings, length };
  }

  // --- Reduce crossings by reordering marriage groups within a row. ---
  // Two couples sitting in the opposite order to their children force their
  // lines to cross. Once everyone is placed, neither couple's exact spot is
  // load-bearing any more, so neighbouring groups swap places whenever that
  // removes a crossing (or, at no extra crossings, shortens the lines).
  // Whole marriage groups move at once, so spouses stay side by side, and a
  // swap fills exactly the span the two groups occupied, so nothing can
  // collide or drift into another row's business.
  const marriedPairs = new Set<string>();
  for (const fam of data.families.values()) {
    if (fam.husb && fam.wife) {
      marriedPairs.add(`${fam.husb}|${fam.wife}`);
      marriedPairs.add(`${fam.wife}|${fam.husb}`);
    }
  }

  const rowBlocks = (row: number): TilePosition[][] => {
    const inRow = [...tiles.values()].filter((t) => t.generation === row).sort((a, b) => a.x - b.x);
    const blocks: TilePosition[][] = [];
    for (const tile of inRow) {
      const current = blocks[blocks.length - 1];
      const prev = current?.[current.length - 1];
      const joinsPrevious =
        prev !== undefined &&
        tile.x - (prev.x + prev.w) <= COL_GAP + 0.5 &&
        marriedPairs.has(`${prev.id}|${tile.id}`);
      if (joinsPrevious) current!.push(tile);
      else blocks.push([tile]);
    }
    return blocks;
  };

  const spousesOf = (id: string): string[] => {
    const out: string[] = [];
    for (const famId of data.individuals.get(id)?.fams ?? []) {
      const fam = data.families.get(famId);
      for (const spouse of [fam?.husb, fam?.wife]) if (spouse && spouse !== id) out.push(spouse);
    }
    return out;
  };

  const blockWidth = (block: TilePosition[]): number =>
    block[block.length - 1].x + block[block.length - 1].w - block[0].x;

  const swapBlocks = (left: TilePosition[], right: TilePosition[]): void => {
    const leftStart = left[0].x;
    const leftEnd = left[left.length - 1].x + left[left.length - 1].w;
    const rightStart = right[0].x;
    const rightEnd = right[right.length - 1].x + right[right.length - 1].w;
    const between = rightStart - leftEnd;
    for (const tile of right) tile.x += leftStart - rightStart;
    for (const tile of left) tile.x += rightEnd - rightStart + between;
  };

  /** Where a group's own connections would like it to sit: over its
   * children, and under its parents. */
  const idealCentreOf = (block: TilePosition[]): number | undefined => {
    const pulls: number[] = [];
    const centreOfAll = (ids: (string | undefined)[]): number | undefined => {
      const centres = ids
        .map((id) => (id ? tiles.get(id) : undefined))
        .filter((t): t is TilePosition => !!t)
        .map((t) => t.x + t.w / 2);
      if (centres.length === 0) return undefined;
      return (Math.min(...centres) + Math.max(...centres)) / 2;
    };

    for (const tile of block) {
      const person = data.individuals.get(tile.id);
      for (const famId of person?.fams ?? []) {
        const fam = data.families.get(famId);
        const childPull = centreOfAll(fam?.children ?? []);
        if (childPull !== undefined) pulls.push(childPull);
        const partner = fam?.husb === tile.id ? fam?.wife : fam?.husb;
        if (partner && !block.some((b) => b.id === partner)) {
          const partnerPull = centreOfAll([partner]);
          if (partnerPull !== undefined) pulls.push(partnerPull);
        }
      }
      for (const famId of person?.famc ?? []) {
        const fam = data.families.get(famId);
        const parentPull = centreOfAll([fam?.husb, fam?.wife]);
        if (parentPull !== undefined) pulls.push(parentPull);
        const siblingPull = centreOfAll(
          (fam?.children ?? []).filter((c) => !block.some((b) => b.id === c)),
        );
        if (siblingPull !== undefined) pulls.push(siblingPull);
      }
    }
    if (pulls.length === 0) return undefined;
    return pulls.reduce((a, b) => a + b, 0) / pulls.length;
  };

  /** Moves a marriage group to the free spot nearest where its own lines
   * want it. Where the build-up had to park a group in whatever space
   * happened to be free - a sister with no children of her own, or parents
   * whose only child was already placed by another branch - this is what
   * brings it back next to the people it belongs with. */
  const slideBlock = (block: TilePosition[]): void => {
    const ideal = idealCentreOf(block);
    if (ideal === undefined) return;
    const width = blockWidth(block);
    const row = block[0].generation;
    const occupied: Extent[] = [];
    for (const tile of tiles.values()) {
      if (tile.generation !== row || block.includes(tile)) continue;
      occupied.push({ min: tile.x, max: tile.x + tile.w });
    }
    const shift = fitBlock(ideal - width / 2, width, occupied) - block[0].x;
    if (Math.abs(shift) < 0.5) return;
    for (const tile of block) tile.x += shift;
  };

  /** Turns a marriage group back to front - which side of the couple each
   * partner stands on. The children hang off the line between the two
   * either way, but which partner faces the neighbouring group decides
   * whether the lines to both families' children have to cross. */
  const reverseBlock = (block: TilePosition[]): void => {
    if (block.length < 2) return;
    const gaps: number[] = [];
    for (let i = 1; i < block.length; i++) gaps.push(block[i].x - (block[i - 1].x + block[i - 1].w));
    const reordered = [...block].reverse();
    const reversedGaps = gaps.reverse();
    let x = block[0].x;
    for (let i = 0; i < reordered.length; i++) {
      reordered[i].x = x;
      x += reordered[i].w + (reversedGaps[i] ?? 0);
    }
  };

  /** A marriage group together with everything hanging off it further down:
   * their children, those children's partners, and so on. Swapping two
   * groups only helps if their descendants come along - otherwise the lines
   * from the group to its own children simply cross somewhere else. */
  const descendantsCache = new Map<string, Set<string>>();
  const descendantsOf = (block: TilePosition[]): Set<string> => {
    // Who hangs off a group never changes, only where they sit - worth
    // remembering across the many arrangements tried below.
    const key = block.map((t) => t.id).join('|');
    const cached = descendantsCache.get(key);
    if (cached) return cached;

    const found = new Set(block.map((t) => t.id));
    const queue = [...found];
    for (let head = 0; head < queue.length; head++) {
      const person = data.individuals.get(queue[head]);
      for (const famId of person?.fams ?? []) {
        const fam = data.families.get(famId);
        for (const child of fam?.children ?? []) {
          for (const id of [child, ...spousesOf(child)]) {
            if (!tiles.has(id) || found.has(id)) continue;
            found.add(id);
            queue.push(id);
          }
        }
      }
    }
    descendantsCache.set(key, found);
    return found;
  };

  /** Slides two groups (and their descendants) past each other as rigid
   * bodies: the left one ends where the right one ended, and vice versa. */
  const swapWithDescendants = (left: TilePosition[], right: TilePosition[]): void => {
    const leftSet = descendantsOf(left);
    const rightSet = descendantsOf(right);
    // A shared descendant means the two lines are tangled together anyway;
    // moving them apart is not meaningful.
    for (const id of leftSet) if (rightSet.has(id)) return;

    const leftEnd = left[left.length - 1].x + left[left.length - 1].w;
    const rightEnd = right[right.length - 1].x + right[right.length - 1].w;
    const towardsRight = rightEnd - leftEnd;
    const towardsLeft = left[0].x - right[0].x;
    for (const id of leftSet) tiles.get(id)!.x += towardsRight;
    for (const id of rightSet) tiles.get(id)!.x += towardsLeft;
  };

  /** Whether any row has tiles sitting on top of each other, or closer
   * together than the usual column gap. */
  const hasCollisions = (): boolean => {
    const byRow = new Map<number, TilePosition[]>();
    for (const tile of tiles.values()) {
      if (!byRow.has(tile.generation)) byRow.set(tile.generation, []);
      byRow.get(tile.generation)!.push(tile);
    }
    for (const row of byRow.values()) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w) < COL_GAP - 0.5) return true;
      }
    }
    return false;
  };

  let arrangement = buildConnectors(false);
  const rowsPresent = [...new Set([...tiles.values()].map((t) => t.generation))].sort((a, b) => a - b);

  /** Keeps the change if it is an improvement, otherwise puts everything
   * back the way it was. */
  const tryMove = (move: () => void): boolean => {
    const before = [...tiles.values()].map((tile) => ({ tile, x: tile.x }));
    const undo = () => {
      for (const entry of before) entry.tile.x = entry.x;
    };
    move();
    if (hasCollisions()) {
      undo();
      return false;
    }
    const candidate = buildConnectors(false);
    const better =
      candidate.crossings < arrangement.crossings ||
      (candidate.crossings === arrangement.crossings && candidate.length < arrangement.length - 0.5);
    if (better) {
      arrangement = candidate;
      return true;
    }
    undo();
    return false;
  };

  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const row of rowsPresent) {
      let blocks = rowBlocks(row);
      for (let i = 0; i < blocks.length; i++) {
        if (tryMove(() => slideBlock(blocks[i]))) {
          improved = true;
          blocks = rowBlocks(row);
        }
      }
      for (let i = 0; i < blocks.length; i++) {
        if (tryMove(() => reverseBlock(blocks[i]))) {
          improved = true;
          blocks = rowBlocks(row);
        }
      }
      for (let i = 0; i + 1 < blocks.length; i++) {
        // Only nearby groups are worth trying against each other; a group
        // that belongs far away is brought over by the sliding above.
        for (let j = i + 1; j < Math.min(blocks.length, i + 5); j++) {
          const left = blocks[i];
          const right = blocks[j];
          // Neighbours can always trade places on their own - between them
          // they cover one stretch of the row, and after the swap they still
          // do. Groups further apart would shove whatever sits between them
          // aside unless the two are the same width, which most are.
          const sameWidth = Math.abs(blockWidth(left) - blockWidth(right)) <= 0.5;
          const moved =
            ((j === i + 1 || sameWidth) && tryMove(() => swapBlocks(left, right))) ||
            tryMove(() => swapWithDescendants(left, right));
          if (moved) {
            improved = true;
            blocks = rowBlocks(row);
            break;
          }
        }
      }
    }
    if (!improved) break;
  }

  // The moves above can push a group past the left edge of the canvas,
  // where its tiles would simply be cut off. Put the whole drawing back
  // against a fixed margin, then size the canvas to what is really in it.
  let leftmost = Infinity;
  for (const tile of tiles.values()) leftmost = Math.min(leftmost, tile.x);
  if (Number.isFinite(leftmost) && Math.abs(CANVAS_MARGIN - leftmost) > 0.5) {
    const shift = CANVAS_MARGIN - leftmost;
    for (const tile of tiles.values()) tile.x += shift;
  }

  const connectors = buildConnectors().connectors;
  maxX = 0;
  for (const tile of tiles.values()) maxX = Math.max(maxX, tile.x + tile.w);

  const width = maxX + CANVAS_MARGIN;
  const height = (maxGen + 1) * rowStep + 100;

  return { layout: { tiles, connectors, width, height }, crossings: arrangement.crossings };
}

/**
 * Works out, from a finished drawing, which order each family's children
 * would better be placed in. A child who married into another family is
 * pulled towards where that family sits, so they end up at the end of their
 * own group of brothers and sisters that faces their partner - which is
 * what keeps the two families' lines to their children from crossing.
 * Children without that pull keep their own position, so the usual order by
 * age survives wherever it makes no difference.
 */
function deriveChildOrder(data: GedcomData, layout: GridLayout): Map<string, string[]> {
  const centreOf = (id: string): number | undefined => {
    const tile = layout.tiles.get(id);
    return tile ? tile.x + tile.w / 2 : undefined;
  };

  /** Where someone's own group of brothers and sisters sits as a whole. */
  const groupCentre = (id: string): number | undefined => {
    const famId = data.individuals.get(id)?.famc.find((f) => data.families.has(f));
    const group = famId ? data.families.get(famId)!.children : [];
    const centres = (group.length > 0 ? group : [id])
      .map(centreOf)
      .filter((x): x is number => x !== undefined);
    if (centres.length === 0) return centreOf(id);
    return centres.reduce((a, b) => a + b, 0) / centres.length;
  };

  const order = new Map<string, string[]>();
  for (const fam of data.families.values()) {
    const kids = fam.children.filter((c) => layout.tiles.has(c));
    if (kids.length < 2) continue;

    const pullOf = new Map<string, number>();
    for (const child of kids) {
      const pulls: number[] = [];
      const own = centreOf(child);
      if (own !== undefined) pulls.push(own);
      for (const famId of data.individuals.get(child)?.fams ?? []) {
        const marriage = data.families.get(famId);
        for (const spouse of [marriage?.husb, marriage?.wife]) {
          if (!spouse || spouse === child) continue;
          const pull = groupCentre(spouse);
          if (pull !== undefined) pulls.push(pull);
        }
      }
      pullOf.set(child, pulls.reduce((a, b) => a + b, 0) / Math.max(1, pulls.length));
    }

    order.set(
      fam.id,
      [...kids].sort((a, b) => pullOf.get(a)! - pullOf.get(b)!),
    );
  }
  return order;
}

function sameOrder(a: Map<string, string[]> | undefined, b: Map<string, string[]>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const [famId, kids] of a) {
    const other = b.get(famId);
    if (!other || other.length !== kids.length || kids.some((id, i) => id !== other[i])) return false;
  }
  return true;
}

/**
 * Lays the tree out, then tries again with the order of each family's
 * children reworked from what the first attempt revealed about where
 * everyone ended up - the way layered graph drawing settles an ordering,
 * repeated until it stops changing. The attempt with the fewest crossing
 * lines wins, so a reordering is only kept when it actually pays off.
 */
export function computeGridLayout(data: GedcomData, metrics: LayoutMetrics = DEFAULT_METRICS): GridLayout {
  let current = layoutOnce(data, metrics, undefined);
  let best = current;
  let order: Map<string, string[]> | undefined;

  for (let round = 0; round < 3 && best.crossings > 0; round++) {
    const next = deriveChildOrder(data, current.layout);
    if (sameOrder(order, next)) break;
    order = next;
    current = layoutOnce(data, metrics, order);
    if (
      current.crossings < best.crossings ||
      (current.crossings === best.crossings && current.layout.width < best.layout.width)
    ) {
      best = current;
    }
  }

  return best.layout;
}
