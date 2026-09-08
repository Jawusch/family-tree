import { useMemo, useState } from 'react';
import type { GedcomData } from '../gedcom/types';

interface PersonListTableProps {
  data: GedcomData;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export function PersonListTable({ data, selectedIds, onToggleSelect }: PersonListTableProps) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const all = data.individualOrder.map((id) => data.individuals.get(id)!).filter(Boolean);
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <div className="person-list">
      <input
        type="search"
        className="person-list-search"
        placeholder={`In ${data.individualOrder.length} Personen suchen…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="person-list-table-wrap">
        <table className="person-list-table">
          <thead>
            <tr>
              <th className="col-check"></th>
              <th>Name</th>
              <th>Geschlecht</th>
              <th>Geboren</th>
              <th>Gestorben</th>
              <th>Eltern</th>
              <th>Kinder</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const parentFams = p.famc.map((id) => data.families.get(id)).filter(Boolean);
              const parentNames = parentFams
                .flatMap((f) => [f!.husb, f!.wife])
                .filter((id): id is string => !!id)
                .map((id) => data.individuals.get(id)?.name ?? '?')
                .join(', ');
              const spouseFams = p.fams.map((id) => data.families.get(id)).filter(Boolean);
              const childCount = new Set(spouseFams.flatMap((f) => f!.children)).size;
              const isSelected = selectedIds.has(p.id);

              return (
                <tr key={p.id} className={isSelected ? 'selected' : ''} onClick={() => onToggleSelect(p.id)}>
                  <td className="col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(p.id)} />
                  </td>
                  <td>{p.name}</td>
                  <td>{p.sex === 'M' ? '♂' : p.sex === 'F' ? '♀' : '–'}</td>
                  <td>{p.birth?.date ?? '–'}</td>
                  <td>{p.death?.date ?? '–'}</td>
                  <td className="muted">{parentNames || '–'}</td>
                  <td className="muted">{childCount || '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty-hint">Keine Treffer.</p>}
      </div>
    </div>
  );
}
