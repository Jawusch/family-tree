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
 * Assigns each individual to a generation "row". Real family files often
 * have wildly different research depth on different branches (one side
 * traced back to the 1700s, the in-laws only a couple of generations) -
 * computing generation purely by counting steps in the ancestor DAG makes
 * spouses on the shallower side get dragged arbitrarily deep to match
 * their partner's longer chain, which then cascades to their children and
 * siblings. Birth year doesn't have that problem, so it's used as the
 * primary signal whenever available, bucketed into generation-sized bands;
 * the DAG is only used to fill in people with no usable date, and as a
 * final safety net so a child never ends up level with or above a parent.
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
  for (const [id, y] of years) {
    gen.set(id, Math.round((y - minYear) / spanYears));
  }

  // Fill in anyone without a usable date from a relative who has one:
  // prefer their spouse's generation, then a parent's (+1), then a child's
  // (-1). A few passes since resolving one person can unblock another.
  const unresolved = new Set(data.individualOrder.filter((id) => !gen.has(id) && data.individuals.has(id)));
  for (let pass = 0; pass < 10 && unresolved.size > 0; pass++) {
    for (const id of [...unresolved]) {
      const person = data.individuals.get(id)!;

      let resolved = false;
      for (const famId of person.fams) {
        const fam = data.families.get(famId);
        const spouse = fam?.husb === id ? fam.wife : fam?.wife === id ? fam.husb : undefined;
        if (spouse && gen.has(spouse)) {
          gen.set(id, gen.get(spouse)!);
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        for (const famId of person.famc) {
          const fam = data.families.get(famId);
          const parents = [fam?.husb, fam?.wife].filter((p): p is string => !!p && gen.has(p));
          if (parents.length > 0) {
            gen.set(id, Math.max(...parents.map((p) => gen.get(p)!)) + 1);
            resolved = true;
            break;
          }
        }
      }
      if (!resolved) {
        for (const famId of person.fams) {
          const fam = data.families.get(famId);
          const kids = (fam?.children ?? []).filter((c) => gen.has(c));
          if (kids.length > 0) {
            gen.set(id, Math.min(...kids.map((c) => gen.get(c)!)) - 1);
            resolved = true;
            break;
          }
        }
      }
      if (resolved) unresolved.delete(id);
    }
  }
  for (const id of unresolved) gen.set(id, 0);

  // Three things still need reconciling, and doing them independently
  // fights itself (e.g. a child-vs-parent bump can knock a couple apart
  // again), so they run together until nothing moves:
  //  - a child must never end up level with or above its parents (rounding
  //    can occasionally place consecutive, closely-spaced generations in
  //    the same bucket)
  //  - full siblings (same two parents) always land on the same row - this
  //    takes priority over the rule below, since sharing parents is a hard
  //    fact but "spouses are the same age" is only a usual assumption
  //  - spouses land on the same row (their own bucketed years might differ
  //    by one, or one of them just got bumped by one of the rules above)
  // Every adjustment here only ever moves someone to a *later* generation,
  // and each bump is a single step tied to an actual neighbour already on
  // the grid - so unlike the old ancestor-chain approach, drift can't run
  // away by inheriting how many extra generations happen to be documented
  // on some unrelated branch.
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const fam of data.families.values()) {
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

      const siblings = fam.children.filter((c) => gen.has(c));
      if (siblings.length > 1) {
        const shared = Math.max(...siblings.map((c) => gen.get(c)!));
        for (const c of siblings) {
          if (gen.get(c)! !== shared) {
            gen.set(c, shared);
            changed = true;
          }
        }
      }

      const parentGen = parents.length ? Math.max(...parents.map((p) => gen.get(p)!)) : undefined;
      if (parentGen !== undefined) {
        for (const c of fam.children) {
          if (!gen.has(c)) continue;
          if (gen.get(c)! <= parentGen) {
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
