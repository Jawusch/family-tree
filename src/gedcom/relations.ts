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

function isRoot(data: GedcomData, id: string): boolean {
  const person = data.individuals.get(id);
  if (!person) return true;
  return !person.famc.some((f) => data.families.has(f));
}

/**
 * Fallback used only when no individual in the file has any usable date:
 * assigns generations purely from the famc/fams DAG (child = parent + 1,
 * spouses share a generation).
 */
function computeStructuralGenerations(data: GedcomData): Map<string, number> {
  const gen = new Map<string, number>();
  for (const id of data.individualOrder) gen.set(id, 0);

  const families = [...data.families.values()];
  const maxIterations = Math.max(50, data.individualOrder.length);

  for (let i = 0; i < maxIterations; i++) {
    let changed = false;
    for (const fam of families) {
      const parents = [fam.husb, fam.wife].filter((p): p is string => !!p && gen.has(p));
      if (parents.length === 2) {
        const [a, b] = parents;
        const shared = Math.max(gen.get(a)!, gen.get(b)!);
        if (gen.get(a)! !== shared) {
          gen.set(a, shared);
          changed = true;
        }
        if (gen.get(b)! !== shared) {
          gen.set(b, shared);
          changed = true;
        }
      }
      const parentGen = parents.length ? Math.max(...parents.map((p) => gen.get(p)!)) : undefined;
      if (parentGen !== undefined) {
        for (const c of fam.children) {
          if (!gen.has(c)) continue;
          if (gen.get(c)! < parentGen + 1) {
            gen.set(c, parentGen + 1);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  return gen;
}

/**
 * Assigns each individual to a generation "row".
 *
 * Only genuine roots (no known parents) get their generation from their own
 * birth year, bucketed into generation-sized bands - they're the anchor
 * point for each independent lineage. Everyone else's generation is derived
 * purely structurally (exactly one row below their parents), never from
 * their own birth year. This matters because real family files often have
 * very different research depth on different branches, so two people who
 * are, say, both the grandchild of a root couple can have birth years that
 * round to different buckets on their own even though they're structurally
 * at the exact same depth - deriving everyone's row from their own year
 * used to let that rounding noise misalign people who are, in fact, the
 * same number of generations from an ancestor.
 *
 * Two independent lineages only ever reconcile at the point they actually
 * meet - a marriage - where the couple is equalised onto the later of their
 * two rows; that then propagates forward to their own descendants exactly
 * as normal, but never back up into either spouse's already-settled
 * ancestors. So unlike naively re-deriving generation by counting ancestor
 * steps everywhere, drift can't compound across a whole chain of marriages
 * into unrelated, more deeply documented branches.
 */
export function computeGenerations(data: GedcomData): Map<string, number> {
  const years = new Map<string, number>();
  for (const id of data.individualOrder) {
    const y = estimateYear(data, id);
    if (y !== undefined) years.set(id, y);
  }

  if (years.size === 0) {
    return computeStructuralGenerations(data);
  }

  const spanYears = computeGenerationSpanYears(data, years);
  const minYear = Math.min(...years.values());

  const gen = new Map<string, number>();
  for (const id of data.individualOrder) {
    if (!data.individuals.has(id) || !isRoot(data, id)) continue;
    const y = years.get(id);
    if (y !== undefined) gen.set(id, Math.round((y - minYear) / spanYears));
  }

  for (let pass = 0; pass < 50; pass++) {
    let changed = false;

    for (const fam of data.families.values()) {
      // Spouses reconcile onto the same row - but someone with known blood
      // parents is authoritative (their row is a hard structural fact, and
      // it's what keeps them aligned with their own siblings), so a root
      // partner (unknown ancestry) always defers to them, never the other
      // way round. Two roots (or two blood descendants of independent
      // lines) equalise onto the later of the two as before.
      if (fam.husb && fam.wife) {
        const husbBlood = !isRoot(data, fam.husb);
        const wifeBlood = !isRoot(data, fam.wife);
        const husbGen = gen.get(fam.husb);
        const wifeGen = gen.get(fam.wife);

        if (husbBlood && !wifeBlood) {
          if (husbGen !== undefined && wifeGen !== husbGen) {
            gen.set(fam.wife, husbGen);
            changed = true;
          }
        } else if (wifeBlood && !husbBlood) {
          if (wifeGen !== undefined && husbGen !== wifeGen) {
            gen.set(fam.husb, wifeGen);
            changed = true;
          }
        } else {
          const known = [fam.husb, fam.wife].filter((p) => gen.has(p));
          if (known.length > 0) {
            const shared = Math.max(...known.map((p) => gen.get(p)!));
            if (gen.get(fam.husb) !== shared) {
              gen.set(fam.husb, shared);
              changed = true;
            }
            if (gen.get(fam.wife) !== shared) {
              gen.set(fam.wife, shared);
              changed = true;
            }
          }
        }
      }

      // Every child sits exactly one row below their (resolved) parents.
      const parents = [fam.husb, fam.wife].filter((p): p is string => !!p && gen.has(p));
      if (parents.length === 0) continue;
      const childGen = Math.max(...parents.map((p) => gen.get(p)!)) + 1;
      for (const c of fam.children) {
        if (!data.individuals.has(c)) continue;
        if (gen.get(c) !== childGen) {
          gen.set(c, childGen);
          changed = true;
        }
      }
    }

    // Last-resort inference for anyone still unresolved at this point (a
    // root with no usable date whose spouse is also still unresolved, or
    // someone whose parents never resolved either): borrow a row from a
    // child instead, one row up.
    for (const id of data.individualOrder) {
      if (gen.has(id) || !data.individuals.has(id)) continue;
      const person = data.individuals.get(id)!;
      for (const famId of person.fams) {
        const fam = data.families.get(famId);
        const kids = (fam?.children ?? []).filter((c) => gen.has(c));
        if (kids.length > 0) {
          gen.set(id, Math.min(...kids.map((c) => gen.get(c)!)) - 1);
          changed = true;
          break;
        }
      }
    }

    if (!changed) break;
  }

  // Anyone left (fully isolated: no date, no spouse, no parent, no child
  // anywhere in the file) defaults to generation 0.
  for (const id of data.individualOrder) {
    if (!gen.has(id) && data.individuals.has(id)) gen.set(id, 0);
  }

  return gen;
}
