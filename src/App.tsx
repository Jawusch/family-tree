import { useEffect, useMemo, useState } from 'react';
import { parseGedcom } from './gedcom/parser';
import { computeGridLayout } from './gedcom/gridLayout';
import { deletePeople } from './gedcom/mutate';
import { serializeGedcom, deserializeGedcom } from './gedcom/serialize';
import type { GedcomData } from './gedcom/types';
import { ImportScreen } from './components/ImportScreen';
import { TreeGraph } from './components/TreeGraph';
import { PersonListTable } from './components/PersonListTable';
import { ConfirmDialog } from './components/ConfirmDialog';
import { loadGedcom, saveGedcom, clearGedcom } from './storage/localStore';

type View = 'graph' | 'list';

interface PendingDeletion {
  ids: string[];
  message: string;
}

function App() {
  const [data, setData] = useState<GedcomData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [view, setView] = useState<View>('graph');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [restoring, setRestoring] = useState(true);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);

  useEffect(() => {
    loadGedcom().then((stored) => {
      if (stored) {
        try {
          setData(deserializeGedcom(stored));
          setFileName(stored.fileName);
        } catch {
          // ignore corrupt cache, user can just re-import
        }
      }
      setRestoring(false);
    });
  }, []);

  const persist = (nextData: GedcomData, name: string) => {
    void saveGedcom(serializeGedcom(nextData, name, new Date().toISOString()));
  };

  const handleFileText = (text: string, name: string) => {
    try {
      const parsed = parseGedcom(text, name);
      if (parsed.individuals.size === 0) {
        setError('Keine Personen in dieser Datei gefunden. Ist es eine gültige GEDCOM-Datei (.ged)?');
        return;
      }
      setError(undefined);
      setData(parsed);
      setFileName(name);
      setSelectedIds(new Set());
      persist(parsed, name);
    } catch {
      setError('Die Datei konnte nicht gelesen werden. Bitte prüfe, ob es sich um eine gültige GEDCOM-Datei handelt.');
    }
  };

  const layout = useMemo(() => (data ? computeGridLayout(data) : null), [data]);

  const handleReset = () => {
    setData(null);
    setFileName('');
    setSelectedIds(new Set());
    setError(undefined);
    void clearGedcom();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteOne = (id: string) => {
    if (!data) return;
    const person = data.individuals.get(id);
    setPendingDeletion({ ids: [id], message: `„${person?.name ?? id}“ wirklich löschen?` });
  };

  const handleDeleteSelected = () => {
    if (!data || selectedIds.size === 0) return;
    setPendingDeletion({ ids: [...selectedIds], message: `${selectedIds.size} Personen wirklich löschen?` });
  };

  const confirmDeletion = () => {
    if (!data || !pendingDeletion) return;
    const next = deletePeople(data, pendingDeletion.ids);
    setData(next);
    setSelectedIds((prev) => {
      const s = new Set(prev);
      for (const id of pendingDeletion.ids) s.delete(id);
      return s;
    });
    persist(next, fileName);
    setPendingDeletion(null);
  };

  if (restoring) {
    return <div className="app-loading">Lade…</div>;
  }

  if (!data || !layout) {
    return <ImportScreen onFileText={handleFileText} errorMessage={error} />;
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-title">
          <strong>{fileName}</strong>
          <span className="muted">
            {data.individuals.size} Personen · {data.families.size} Familien
          </span>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <span className="muted">{selectedIds.size} ausgewählt</span>
              <button className="danger" onClick={handleDeleteSelected}>
                Ausgewählte löschen
              </button>
              <button className="secondary" onClick={() => setSelectedIds(new Set())}>
                Auswahl aufheben
              </button>
            </>
          )}
          <div className="view-switch">
            <button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>
              Baum
            </button>
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              Liste
            </button>
          </div>
          <button className="secondary" onClick={handleReset}>
            Andere Datei importieren
          </button>
        </div>
      </header>

      {data.warnings.length > 0 && (
        <div className="warnings-banner">
          {data.warnings.length} Hinweis(e) beim Import — Daten wurden trotzdem angezeigt.
        </div>
      )}

      <main className="main-content">
        <div className="main-view">
          {view === 'graph' ? (
            <TreeGraph
              data={data}
              layout={layout}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onDeleteOne={handleDeleteOne}
            />
          ) : (
            <PersonListTable
              data={data}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onDeleteOne={handleDeleteOne}
            />
          )}
        </div>
      </main>

      {pendingDeletion && (
        <ConfirmDialog
          message={pendingDeletion.message}
          onConfirm={confirmDeletion}
          onCancel={() => setPendingDeletion(null)}
        />
      )}
    </div>
  );
}

export default App;
