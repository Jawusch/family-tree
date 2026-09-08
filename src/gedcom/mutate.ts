import type { Family, GedcomData } from './types';

/**
 * Removes the given individuals from the dataset and cleans up every
 * reference to them: they're dropped from any family they were a spouse or
 * child in, families left with no spouse and no children are removed
 * entirely, and remaining individuals' famc/fams pointers are pruned to
 * only families that still exist.
 */
export function deletePeople(data: GedcomData, idsToDelete: Iterable<string>): GedcomData {
  const removeSet = new Set(idsToDelete);
  if (removeSet.size === 0) return data;

  const individuals = new Map(data.individuals);
  for (const id of removeSet) individuals.delete(id);

  const families = new Map<string, Family>();
  const familyOrder: string[] = [];
  for (const famId of data.familyOrder) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    const husb = fam.husb && !removeSet.has(fam.husb) ? fam.husb : undefined;
    const wife = fam.wife && !removeSet.has(fam.wife) ? fam.wife : undefined;
    const children = fam.children.filter((c) => !removeSet.has(c));
    if (!husb && !wife && children.length === 0) continue;
    families.set(famId, { ...fam, husb, wife, children });
    familyOrder.push(famId);
  }

  for (const [id, person] of individuals) {
    const famc = person.famc.filter((f) => families.has(f));
    const fams = person.fams.filter((f) => families.has(f));
    if (famc.length !== person.famc.length || fams.length !== person.fams.length) {
      individuals.set(id, { ...person, famc, fams });
    }
  }

  const individualOrder = data.individualOrder.filter((id) => individuals.has(id));

  return {
    individuals,
    families,
    individualOrder,
    familyOrder,
    sourceFileName: data.sourceFileName,
    warnings: data.warnings,
  };
}
