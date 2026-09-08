import { useEffect, useMemo, useState } from 'react';
import { parseGedcom } from './gedcom/parser';
import { computeLayout } from './gedcom/layout';
import type { GedcomData } from './gedcom/types';
import { ImportScreen } from './components/ImportScreen';
import { TreeGraph } from './components/TreeGraph';
import { PersonListTable } from './components/PersonListTable';
import { PersonDetails } from './components/PersonDetails';
import { loadLastGedcom, saveLastGedcom, clearLastGedcom } from './storage/localStore';

type View = 'graph' | 'list';

function App() {
  const [data, setData] = useState<GedcomData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [view, setView] = useState<View>('graph');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    loadLastGedcom().then((stored) => {
      if (stored) {
        try {
          const parsed = parseGedcom(stored.text, stored.fileName);
          setData(parsed);
          setFileName(stored.fileName);
        } catch {
          // ignore corrupt cache, user can just re-import
        }
      }
      setRestoring(false);
    });
  }, []);

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
      setSelectedId(null);
      void saveLastGedcom({ fileName: name, text, importedAt: new Date().toISOString() });
    } catch {
      setError('Die Datei konnte nicht gelesen werden. Bitte prüfe, ob es sich um eine gültige GEDCOM-Datei handelt.');
    }
  };

  const layout = useMemo(() => (data ? computeLayout(data) : null), [data]);

  const handleReset = () => {
    setData(null);
    setFileName('');
    setSelectedId(null);
    setError(undefined);
    void clearLastGedcom();
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
            <TreeGraph data={data} layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <PersonListTable data={data} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
        {selectedId && (
          <PersonDetails
            data={data}
            personId={selectedId}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
