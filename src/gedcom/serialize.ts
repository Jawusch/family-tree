import type { Family, GedcomData, Individual } from './types';

export interface SerializedGedcom {
  fileName: string;
  individuals: Individual[];
  families: Family[];
  individualOrder: string[];
  familyOrder: string[];
  warnings: string[];
  importedAt: string;
}

export function serializeGedcom(data: GedcomData, fileName: string, importedAt: string): SerializedGedcom {
  return {
    fileName,
    individuals: data.individualOrder.map((id) => data.individuals.get(id)!).filter(Boolean),
    families: data.familyOrder.map((id) => data.families.get(id)!).filter(Boolean),
    individualOrder: data.individualOrder,
    familyOrder: data.familyOrder,
    warnings: data.warnings,
    importedAt,
  };
}

export function deserializeGedcom(s: SerializedGedcom): GedcomData {
  const individuals = new Map(s.individuals.map((p) => [p.id, p]));
  const families = new Map(s.families.map((f) => [f.id, f]));
  return {
    individuals,
    families,
    individualOrder: s.individualOrder.filter((id) => individuals.has(id)),
    familyOrder: s.familyOrder.filter((id) => families.has(id)),
    sourceFileName: s.fileName,
    warnings: s.warnings,
  };
}
