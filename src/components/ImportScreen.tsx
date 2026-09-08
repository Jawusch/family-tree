import { useCallback, useRef, useState } from 'react';

interface ImportScreenProps {
  onFileText: (text: string, fileName: string) => void;
  /** Loads the GEDCOM file bundled with the app. */
  onLoadStarter: () => void;
  starterName: string;
  errorMessage?: string;
}

export function ImportScreen({ onFileText, onLoadStarter, starterName, errorMessage }: ImportScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        onFileText(String(reader.result ?? ''), file.name);
      };
      reader.readAsText(file);
    },
    [onFileText],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  return (
    <div className="import-screen">
      <div className="import-card">
        <h1>Stammbaum-Viewer</h1>
        <p className="subtitle">
          Importiere eine GEDCOM-Datei (.ged), um alle Personen und ihre Beziehungen anzuzeigen.
        </p>

        <div
          className={`dropzone${isDragging ? ' dropzone--active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <p>GEDCOM-Datei hierher ziehen oder klicken zum Auswählen</p>
          <span className="dropzone-hint">.ged Dateien</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".ged,text/plain"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
            e.target.value = '';
          }}
        />

        <p className="import-alt">
          oder{' '}
          <button type="button" className="link-button" onClick={onLoadStarter}>
            mitgelieferten Stammbaum ({starterName}) laden
          </button>
        </p>

        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </div>
    </div>
  );
}
