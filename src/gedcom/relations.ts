import type { GedcomData } from './types';

export interface GraphNode {
  id: string;
  generation: number;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: 'parent-child' | 'spouse';
}

export interface RelationGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

/**
 * Assigns a generation number to every individual (0 = oldest known
 * ancestors) and equalises spouses onto the same generation, then builds
 * the parent-child / spouse edge list used for layout and rendering.
 *
 * Family data is rarely a clean DAG in file order (remarriages, missing
 * links, etc.), so generations are computed by relaxation: repeatedly
 * propagate "child = max(parents) + 1" and "spouses share a generation"
 * until nothing changes or a safety cap is hit.
 */
export function buildRelationGraph(data: GedcomData): RelationGraph {
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

  const nodes: GraphNode[] = data.individualOrder.map((id) => ({
    id,
    generation: gen.get(id) ?? 0,
  }));

  const links: GraphLink[] = [];
  const seenSpousePairs = new Set<string>();

  for (const fam of families) {
    if (fam.husb && fam.wife && data.individuals.has(fam.husb) && data.individuals.has(fam.wife)) {
      const key = [fam.husb, fam.wife].sort().join('|');
      if (!seenSpousePairs.has(key)) {
        seenSpousePairs.add(key);
        links.push({ source: fam.husb, target: fam.wife, kind: 'spouse' });
      }
    }
    const parents = [fam.husb, fam.wife].filter((p): p is string => !!p && data.individuals.has(p));
    for (const c of fam.children) {
      if (!data.individuals.has(c)) continue;
      for (const p of parents) {
        links.push({ source: p, target: c, kind: 'parent-child' });
      }
    }
  }

  return { nodes, links };
}

export interface PersonRelations {
  parents: string[];
  siblings: string[];
  spouses: string[];
  children: string[];
  /** Children of the person's siblings. */
  nieceNephews: string[];
  /** Siblings of the person's parents. */
  auntsUncles: string[];
  /** Children of aunts/uncles. */
  cousins: string[];
}

export function getPersonRelations(data: GedcomData, personId: string): PersonRelations {
  const person = data.individuals.get(personId);
  if (!person) {
    return { parents: [], siblings: [], spouses: [], children: [], nieceNephews: [], auntsUncles: [], cousins: [] };
  }

  const parentFamilies = person.famc.map((id) => data.families.get(id)).filter((f) => !!f);
  const parents = new Set<string>();
  const siblings = new Set<string>();
  for (const fam of parentFamilies) {
    if (fam!.husb) parents.add(fam!.husb);
    if (fam!.wife) parents.add(fam!.wife);
    for (const c of fam!.children) if (c !== personId) siblings.add(c);
  }

  const spouseFamilies = person.fams.map((id) => data.families.get(id)).filter((f) => !!f);
  const spouses = new Set<string>();
  const childIds = new Set<string>();
  for (const fam of spouseFamilies) {
    if (fam!.husb && fam!.husb !== personId) spouses.add(fam!.husb);
    if (fam!.wife && fam!.wife !== personId) spouses.add(fam!.wife);
    for (const c of fam!.children) childIds.add(c);
  }

  const nieceNephews = new Set<string>();
  for (const sibId of siblings) {
    const sib = data.individuals.get(sibId);
    if (!sib) continue;
    for (const famId of sib.fams) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      for (const c of fam.children) nieceNephews.add(c);
    }
  }

  const auntsUncles = new Set<string>();
  const cousins = new Set<string>();
  for (const parentId of parents) {
    const parent = data.individuals.get(parentId);
    if (!parent) continue;
    for (const gfamId of parent.famc) {
      const gfam = data.families.get(gfamId);
      if (!gfam) continue;
      for (const auId of gfam.children) {
        if (auId === parentId) continue;
        auntsUncles.add(auId);
        const au = data.individuals.get(auId);
        if (!au) continue;
        for (const famId of au.fams) {
          const fam = data.families.get(famId);
          if (!fam) continue;
          for (const c of fam.children) cousins.add(c);
        }
      }
    }
  }

  return {
    parents: [...parents],
    siblings: [...siblings],
    spouses: [...spouses],
    children: [...childIds],
    nieceNephews: [...nieceNephews],
    auntsUncles: [...auntsUncles],
    cousins: [...cousins],
  };
}
