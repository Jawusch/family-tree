export interface DateInfo {
  raw: string;
}

export interface EventInfo {
  date?: string;
  place?: string;
}

export interface Individual {
  id: string;
  givenName: string;
  surname: string;
  name: string;
  sex: 'M' | 'F' | 'U';
  birth?: EventInfo;
  death?: EventInfo;
  /** Family IDs in which this person is a child */
  famc: string[];
  /** Family IDs in which this person is a spouse/parent */
  fams: string[];
  /** Free-text occupation/notes, kept minimal for now */
  notes?: string;
}

export interface Family {
  id: string;
  husb?: string;
  wife?: string;
  children: string[];
  marriage?: EventInfo;
}

export interface GedcomData {
  individuals: Map<string, Individual>;
  families: Map<string, Family>;
  /** Individual ids in file order, for stable iteration */
  individualOrder: string[];
  familyOrder: string[];
  sourceFileName?: string;
  warnings: string[];
}
