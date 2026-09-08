import type { EventInfo, GedcomData, Individual } from './types';

function nameLine(person: Individual): string {
  const given = person.givenName?.trim() ?? '';
  const surname = person.surname?.trim() ?? '';
  if (given && surname) return `${given} /${surname}/`;
  if (surname) return `/${surname}/`;
  if (given) return given;
  return person.name || 'Unbekannt';
}

function pushEvent(lines: string[], tag: string, event: EventInfo | undefined): void {
  if (!event || (!event.date && !event.place)) return;
  lines.push(`1 ${tag}`);
  if (event.date) lines.push(`2 DATE ${event.date}`);
  if (event.place) lines.push(`2 PLAC ${event.place}`);
}

/**
 * Serialises the current (possibly edited) dataset back into a GEDCOM 5.5.1
 * file. Only the fields the app actually tracks are written out - names,
 * sex, birth/death date+place, marriage date+place, and family links.
 * Anything the parser doesn't currently read from the original file
 * (occupation, notes, sources, etc.) was never kept in memory, so it can't
 * round-trip and won't appear in the export.
 */
export function exportGedcom(data: GedcomData): string {
  const lines: string[] = [];

  lines.push('0 HEAD');
  lines.push('1 SOUR FamilyTree');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');

  for (const id of data.individualOrder) {
    const person = data.individuals.get(id);
    if (!person) continue;
    lines.push(`0 @${id}@ INDI`);
    lines.push(`1 NAME ${nameLine(person)}`);
    if (person.sex === 'M' || person.sex === 'F') lines.push(`1 SEX ${person.sex}`);
    pushEvent(lines, 'BIRT', person.birth);
    pushEvent(lines, 'DEAT', person.death);
    for (const famId of person.famc) lines.push(`1 FAMC @${famId}@`);
    for (const famId of person.fams) lines.push(`1 FAMS @${famId}@`);
  }

  for (const id of data.familyOrder) {
    const fam = data.families.get(id);
    if (!fam) continue;
    lines.push(`0 @${id}@ FAM`);
    if (fam.husb) lines.push(`1 HUSB @${fam.husb}@`);
    if (fam.wife) lines.push(`1 WIFE @${fam.wife}@`);
    for (const childId of fam.children) lines.push(`1 CHIL @${childId}@`);
    pushEvent(lines, 'MARR', fam.marriage);
  }

  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}
