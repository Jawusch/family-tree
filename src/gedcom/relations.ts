import type { GedcomData } from './types';

function parseYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const m = dateStr.match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

/** Best-effort birth year, falling back to a rough estimate from the death
 * year when birth is unknown. */
function estimateYear(data: GedcomData, id: string): number | undefined {
  const person = data.individuals.get(id);
  if (!person) return undefined;
  const birth = parseYear(person.birth?.date);
  if (birth !== undefined) return birth;
  const death = parseYear(person.death?.date);
  if (death !== undefined) return death - 40;
  return undefined;
}

/** Median parent -> child birth-year gap found in the data, used as the
 * generation "row height" in years. Falls back to a typical 28 years. */
function computeGenerationSpanYears(data: GedcomData, years: Map<string, number>): number {
  const diffs: number[] = [];
  for (const fam of data.families.values()) {
    const parentYears = [fam.husb, fam.wife]
      .filter((p): p is string => !!p)
      .map((p) => years.get(p))
      .filter((y): y is number => y !== undefined);
    if (parentYears.length === 0) continue;
    const parentYear = Math.min(...parentYears);
    for (const c of fam.children) {
      const childYear = years.get(c);
      if (childYear !== undefined) diffs.push(childYear - parentYear);
    }
  }
  if (diffs.length === 0) return 28;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  return Math.min(40, Math.max(15, median));
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Union-find over blood groups that also tracks how many rows one group's
 * row 0 sits below another's. Used to tie groups together across childless
 * marriages, where the only thing known is that two specific people share a
 * row.
 */
class OffsetUnionFind {
  private parent: number[];
  private offset: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.offset = new Array(size).fill(0);
  }

  /** The group's root, plus this group's row offset relative to it. */
  find(i: number): { root: number; offset: number } {
    if (this.parent[i] === i) return { root: i, offset: 0 };
    const up = this.find(this.parent[i]);
    // Path compression, keeping the accumulated offset correct.
    this.parent[i] = up.root;
    this.offset[i] += up.offset;
    return { root: up.root, offset: this.offset[i] };
  }

  /** Ties `a` and `b` together so that base(a) - base(b) === delta. Returns
   * false if they were already tied at a different distance (an
   * inconsistency in the data), leaving them as they were. */
  union(a: number, b: number, delta: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra.root === rb.root) return ra.offset - rb.offset === delta;
    this.parent[ra.root] = rb.root;
    this.offset[ra.root] = delta + rb.offset - ra.offset;
    return true;
  }
}

/**
 * Assigns each individual to a generation "row".
 *
 * The assignment is structural, not date-driven: a parent always sits
 * exactly one row above their child. That also settles two things on its
 * own - both parents of a child share a row, and all children of a family
 * share a row - and following those steps through the file links everyone
 * related by descent into one "blood group" whose rows are fixed relative
 * to each other. A branch that happens to be researched more deeply than
 * its neighbour can no longer drift, because the rows come from the
 * relationships themselves.
 *
 * Birth years deliberately play no part in that. They are used only at the
 * very end, to decide how groups that share no relative at all line up
 * against each other - the one thing the structure genuinely cannot say.
 * Deriving rows from a person's own year (even just for people with no
 * known parents, as this used to) put someone born in 1903 on the same row
 * as someone born in 1887 merely because the two years round into the same
 * band, which then pulled that person's entire line one row out of place.
 *
 * A childless marriage is the one soft constraint: it ties two otherwise
 * separate groups together, unless they are already tied at a different
 * distance - in which case the descent relationships win.
 */
export function computeGenerations(data: GedcomData): Map<string, number> {
  const ids = data.individualOrder.filter((id) => data.individuals.has(id));

  // --- 1. Walk descent links to build blood groups with relative rows. ---
  const steps = new Map<string, { to: string; delta: number }[]>();
  const addStep = (from: string, to: string, delta: number) => {
    if (!steps.has(from)) steps.set(from, []);
    steps.get(from)!.push({ to, delta });
  };

  for (const fam of data.families.values()) {
    const parents = [fam.husb, fam.wife].filter((p): p is string => !!p && data.individuals.has(p));
    const children = fam.children.filter((c) => data.individuals.has(c));
    for (const parent of parents) {
      for (const child of children) {
        addStep(parent, child, 1);
        addStep(child, parent, -1);
      }
    }
  }

  const level = new Map<string, number>();
  const groupOf = new Map<string, number>();
  const groups: string[][] = [];

  for (const start of ids) {
    if (level.has(start)) continue;
    const index = groups.length;
    const members: string[] = [start];
    level.set(start, 0);
    groupOf.set(start, index);

    for (let head = 0; head < members.length; head++) {
      const current = members[head];
      for (const step of steps.get(current) ?? []) {
        if (level.has(step.to)) continue;
        // Reaching someone already placed at a different row would mean the
        // file has a person as their own ancestor at two different depths.
        // The row found first wins, and the rest of the group stays
        // consistent with it.
        level.set(step.to, level.get(current)! + step.delta);
        groupOf.set(step.to, index);
        members.push(step.to);
      }
    }

    groups.push(members);
  }

  // --- 2. Tie groups together across childless marriages. ---
  const links = new OffsetUnionFind(groups.length);
  for (const fam of data.families.values()) {
    const { husb, wife } = fam;
    if (!husb || !wife || !data.individuals.has(husb) || !data.individuals.has(wife)) continue;
    const a = groupOf.get(husb)!;
    const b = groupOf.get(wife)!;
    if (a === b) continue;
    links.union(a, b, level.get(wife)! - level.get(husb)!);
  }

  const rowOf = new Map<string, number>();
  const tiedGroups = new Map<number, string[]>();
  for (const id of ids) {
    const { root, offset } = links.find(groupOf.get(id)!);
    rowOf.set(id, level.get(id)! + offset);
    if (!tiedGroups.has(root)) tiedGroups.set(root, []);
    tiedGroups.get(root)!.push(id);
  }

  // --- 3. Place groups that share nobody on a common timeline. ---
  // Everything above is relative: a tied group knows its own internal rows
  // but not how it lines up with a group it has no relative in. Birth years
  // are the only clue left, so each group is anchored by the year its row 0
  // works out to.
  const years = new Map<string, number>();
  for (const id of ids) {
    const y = estimateYear(data, id);
    if (y !== undefined) years.set(id, y);
  }
  const spanYears = computeGenerationSpanYears(data, years);

  const anchors = new Map<number, number>();
  for (const [root, members] of tiedGroups) {
    const dated = members
      .filter((id) => years.has(id))
      .map((id) => years.get(id)! - rowOf.get(id)! * spanYears);
    if (dated.length > 0) anchors.set(root, medianOf(dated));
  }
  // A group without a single date sits where the typical group sits.
  const fallbackAnchor = anchors.size > 0 ? medianOf([...anchors.values()]) : 0;

  const generations = new Map<string, number>();
  for (const id of ids) {
    const { root } = links.find(groupOf.get(id)!);
    const anchor = anchors.get(root) ?? fallbackAnchor;
    generations.set(id, rowOf.get(id)! + Math.round(anchor / spanYears));
  }

  // Normalise so the oldest generation is row 0.
  const lowest = Math.min(...generations.values());
  if (Number.isFinite(lowest) && lowest !== 0) {
    for (const [id, g] of generations) generations.set(id, g - lowest);
  }

  return generations;
}
