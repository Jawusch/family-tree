import type { GedcomData } from './types';

/**
 * Assigns a generation number to every individual (0 = oldest known
 * ancestors) and equalises spouses onto the same generation.
 *
 * Family data is rarely a clean DAG in file order (remarriages, missing
 * links, etc.), so generations are computed by relaxation: repeatedly
 * propagate "child = max(parents) + 1" and "spouses share a generation"
 * until nothing changes or a safety cap is hit.
 */
export function computeGenerations(data: GedcomData): Map<string, number> {
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

      const parentGen = parents.length
        ? Math.max(...parents.map((p) => gen.get(p)!))
        : undefined;

      if (parentGen !== undefined) {
        for (const c of fam.children) {
          if (!gen.has(c)) continue;
          const required = parentGen + 1;
          if (gen.get(c)! < required) {
            gen.set(c, required);
            changed = true;
          }
        }
      }
    }

    if (!changed) break;
  }

  return gen;
}
