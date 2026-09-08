import type { EventInfo, Family, GedcomData, Individual } from './types';

/** A single raw GEDCOM line, split into its parts. */
interface RawLine {
  level: number;
  xref?: string;
  tag: string;
  value?: string;
}

/** A node in the GEDCOM tree, built from raw lines by nesting on `level`. */
interface GedcomNode {
  tag: string;
  xref?: string;
  value?: string;
  children: GedcomNode[];
}

const LINE_WITH_XREF = /^(\d+)\s+(@[^@]+@)\s+(\S+)(?:\s(.*))?$/;
const LINE_PLAIN = /^(\d+)\s+(\S+)(?:\s(.*))?$/;

function parseLine(line: string): RawLine | null {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return null;

  const withXref = trimmed.match(LINE_WITH_XREF);
  if (withXref) {
    const [, levelStr, xref, tag, value] = withXref;
    return { level: Number(levelStr), xref, tag, value };
  }

  const plain = trimmed.match(LINE_PLAIN);
  if (plain) {
    const [, levelStr, tag, value] = plain;
    return { level: Number(levelStr), tag, value };
  }

  return null;
}

/** Strips a UTF-8 BOM and normalises line endings. */
function normalise(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Builds a nested tree of GedcomNode from the flat line list. */
function buildTree(lines: RawLine[]): GedcomNode[] {
  const roots: GedcomNode[] = [];
  // stack[i] = last node seen at level i
  const stack: GedcomNode[] = [];

  for (const line of lines) {
    const node: GedcomNode = { tag: line.tag, xref: line.xref, value: line.value, children: [] };
    stack[line.level] = node;
    stack.length = line.level + 1;

    if (line.level === 0) {
      roots.push(node);
    } else {
      const parent = stack[line.level - 1];
      if (parent) {
        parent.children.push(node);
      } else {
        // Malformed / out-of-order level jump - attach to root as fallback.
        roots.push(node);
      }
    }
  }

  return roots;
}

function child(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function children(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((c) => c.tag === tag);
}

function readEvent(node: GedcomNode | undefined): EventInfo | undefined {
  if (!node) return undefined;
  const date = child(node, 'DATE')?.value;
  const place = child(node, 'PLAC')?.value;
  if (!date && !place) return undefined;
  return { date, place };
}

function stripAt(pointer: string | undefined): string | undefined {
  if (!pointer) return undefined;
  return pointer.replace(/^@/, '').replace(/@$/, '');
}

function parseName(raw: string | undefined): { given: string; surname: string; full: string } {
  if (!raw) return { given: '', surname: '', full: 'Unbekannt' };
  // GEDCOM names use /Surname/ markers, e.g. "John Michael /Doe/"
  const match = raw.match(/^([^/]*)\/([^/]*)\/(.*)$/);
  if (match) {
    const given = match[1].trim();
    const surname = match[2].trim();
    const full = [given, surname].filter(Boolean).join(' ').trim() || 'Unbekannt';
    return { given, surname, full };
  }
  const full = raw.trim() || 'Unbekannt';
  return { given: full, surname: '', full };
}

export function parseGedcom(text: string, sourceFileName?: string): GedcomData {
  const warnings: string[] = [];
  const normalised = normalise(text);
  const rawLines = normalised
    .split('\n')
    .map(parseLine)
    .filter((l): l is RawLine => l !== null);

  if (rawLines.length === 0) {
    warnings.push('Die Datei enthielt keine erkennbaren GEDCOM-Zeilen.');
  }

  const tree = buildTree(rawLines);

  const individuals = new Map<string, Individual>();
  const families = new Map<string, Family>();
  const individualOrder: string[] = [];
  const familyOrder: string[] = [];

  for (const node of tree) {
    if (node.tag === 'INDI' && node.xref) {
      const id = stripAt(node.xref)!;
      const nameNode = child(node, 'NAME');
      const { given, surname, full } = parseName(nameNode?.value);
      const sexRaw = child(node, 'SEX')?.value?.toUpperCase();
      const sex: Individual['sex'] = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : 'U';

      const famc = children(node, 'FAMC')
        .map((n) => stripAt(n.value))
        .filter((v): v is string => !!v);
      const fams = children(node, 'FAMS')
        .map((n) => stripAt(n.value))
        .filter((v): v is string => !!v);

      const individual: Individual = {
        id,
        givenName: given,
        surname,
        name: full,
        sex,
        birth: readEvent(child(node, 'BIRT')),
        death: readEvent(child(node, 'DEAT')),
        famc,
        fams,
      };

      individuals.set(id, individual);
      individualOrder.push(id);
    } else if (node.tag === 'FAM' && node.xref) {
      const id = stripAt(node.xref)!;
      const husb = stripAt(child(node, 'HUSB')?.value);
      const wife = stripAt(child(node, 'WIFE')?.value);
      const childIds = children(node, 'CHIL')
        .map((n) => stripAt(n.value))
        .filter((v): v is string => !!v);

      const family: Family = {
        id,
        husb,
        wife,
        children: childIds,
        marriage: readEvent(child(node, 'MARR')),
      };

      families.set(id, family);
      familyOrder.push(id);
    }
  }

  // Sanity-check cross references so the UI can surface data-quality issues
  // without crashing on a malformed file.
  for (const fam of families.values()) {
    if (fam.husb && !individuals.has(fam.husb)) {
      warnings.push(`Familie ${fam.id}: Ehemann ${fam.husb} nicht gefunden.`);
    }
    if (fam.wife && !individuals.has(fam.wife)) {
      warnings.push(`Familie ${fam.id}: Ehefrau ${fam.wife} nicht gefunden.`);
    }
    for (const c of fam.children) {
      if (!individuals.has(c)) {
        warnings.push(`Familie ${fam.id}: Kind ${c} nicht gefunden.`);
      }
    }
  }

  if (individuals.size === 0) {
    warnings.push('Es wurden keine Personen (INDI-Datensätze) in der Datei gefunden.');
  }

  return {
    individuals,
    families,
    individualOrder,
    familyOrder,
    sourceFileName,
    warnings,
  };
}
