import type { GedcomData } from '../gedcom/types';
import { getPersonRelations } from '../gedcom/relations';

interface PersonDetailsProps {
  data: GedcomData;
  personId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function NameList({
  ids,
  data,
  onSelect,
  emptyLabel = 'Keine Angaben',
}: {
  ids: string[];
  data: GedcomData;
  onSelect: (id: string) => void;
  emptyLabel?: string;
}) {
  if (ids.length === 0) return <span className="muted">{emptyLabel}</span>;
  return (
    <span>
      {ids.map((id, i) => {
        const p = data.individuals.get(id);
        return (
          <span key={id}>
            <button className="link-button" onClick={() => onSelect(id)}>
              {p?.name ?? id}
            </button>
            {i < ids.length - 1 ? ', ' : ''}
          </span>
        );
      })}
    </span>
  );
}

export function PersonDetails({ data, personId, onSelect, onClose }: PersonDetailsProps) {
  const person = data.individuals.get(personId);
  const rel = getPersonRelations(data, personId);

  if (!person) return null;

  return (
    <aside className="person-details">
      <button className="close-button" onClick={onClose} aria-label="Schließen">
        ×
      </button>
      <h2>{person.name}</h2>
      <p className="muted">
        {person.sex === 'M' ? 'Männlich' : person.sex === 'F' ? 'Weiblich' : 'Geschlecht unbekannt'}
      </p>

      <dl>
        <dt>Geboren</dt>
        <dd>{[person.birth?.date, person.birth?.place].filter(Boolean).join(', ') || '–'}</dd>
        <dt>Gestorben</dt>
        <dd>{[person.death?.date, person.death?.place].filter(Boolean).join(', ') || '–'}</dd>
      </dl>

      <h3>Eltern</h3>
      <p><NameList ids={rel.parents} data={data} onSelect={onSelect} /></p>

      <h3>Geschwister</h3>
      <p><NameList ids={rel.siblings} data={data} onSelect={onSelect} /></p>

      <h3>Partner:in</h3>
      <p><NameList ids={rel.spouses} data={data} onSelect={onSelect} /></p>

      <h3>Kinder</h3>
      <p><NameList ids={rel.children} data={data} onSelect={onSelect} /></p>

      <h3>Tanten &amp; Onkel</h3>
      <p><NameList ids={rel.auntsUncles} data={data} onSelect={onSelect} /></p>

      <h3>Cousinen &amp; Cousins</h3>
      <p><NameList ids={rel.cousins} data={data} onSelect={onSelect} /></p>

      <h3>Nichten &amp; Neffen</h3>
      <p><NameList ids={rel.nieceNephews} data={data} onSelect={onSelect} /></p>
    </aside>
  );
}
