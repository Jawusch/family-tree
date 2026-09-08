import { useEffect, useMemo, useState } from 'react';
import { parseGedcom } from './gedcom/parser';
import { computeGridLayout } from './gedcom/gridLayout';
import { deletePeople } from './gedcom/mutate';
import { serializeGedcom, deserializeGedcom } from './gedcom/serialize';
import { exportGedcom } from './gedcom/exportGedcom';
import type { GedcomData } from './gedcom/types';
import { ImportScreen } from './components/ImportScreen';
import { TreeGraph } from './components/TreeGraph';
import { PersonListTable } from './components/PersonListTable';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { loadGedcom, saveGedcom, clearGedcom } from './storage/localStore';
import { downloadTextFile } from './utils/download';
import { loadSettings, saveSettings, type TreeSettings } from './tree/settings';
import { buildTileVisuals } from './tree/tileVisuals';
import { exportTreeAsPdf } from './export/pdf';

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
  const [settings, setSettings] = useState<TreeSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

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

  const updateSettings = (next: TreeSettings) => {
    setSettings(next);
    saveSettings(next);
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

  const visuals = useMemo(() => (data ? buildTileVisuals(data, settings) : null), [data, settings]);

  const layout = useMemo(() => {
    if (!data || !visuals) return null;
    return computeGridLayout(data, {
      widthOf: (id) => visuals.byId.get(id)?.width ?? visuals.defaultWidth,
      defaultWidth: visuals.defaultWidth,
      height: visuals.height,
    });
  }, [data, visuals]);

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

  const handleDeleteSelected = () => {
    if (!data || selectedIds.size === 0) return;
    setPendingDeletion({ ids: [...selectedIds], message: `${selectedIds.size} Personen wirklich löschen?` });
  };

  const handleExport = () => {
    if (!data) return;
    const text = exportGedcom(data);
    const base = fileName.replace(/\.ged$/i, '') || 'stammbaum';
    downloadTextFile(text, `${base}_export.ged`);
  };

  const handleExportPdf = async () => {
    if (!data || !layout || !visuals || pdfBusy) return;
    setPdfBusy(true);
    try {
      await exportTreeAsPdf(data, layout, visuals, settings, fileName);
    } catch {
      setError('Das PDF konnte nicht erstellt werden.');
    } finally {
      setPdfBusy(false);
    }
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

  if (!data || !layout || !visuals) {
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
          <button className="secondary" onClick={handleExportPdf} disabled={pdfBusy}>
            {pdfBusy ? 'PDF wird erstellt…' : 'Als PDF speichern'}
          </button>
          <button className="secondary" onClick={handleExport}>
            GEDCOM exportieren
          </button>
          <button className="secondary" onClick={handleReset}>
            Andere Datei importieren
          </button>
          <div className="settings-anchor">
            <button
              className={`icon-button${settingsOpen ? ' active' : ''}`}
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label="Einstellungen"
              aria-expanded={settingsOpen}
              title="Einstellungen"
            >
              <GearIcon />
            </button>
            {settingsOpen && (
              <SettingsPanel
                settings={settings}
                onChange={updateSettings}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
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
              visuals={visuals}
              settings={settings}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          ) : (
            <PersonListTable data={data} selectedIds={selectedIds} onToggleSelect={toggleSelect} />
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

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default App;
