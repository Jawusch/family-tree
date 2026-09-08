import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TILE_WIDTH_MAX,
  TILE_WIDTH_MIN,
  isHexColor,
  type TreeSettings,
} from '../tree/settings';

interface SettingsPanelProps {
  settings: TreeSettings;
  onChange: (settings: TreeSettings) => void;
  onClose: () => void;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-switch" aria-hidden="true" />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // The hex text field is edited freely and only pushed up once it's a
  // complete colour, so typing doesn't repaint the tree on every keystroke.
  // When the colour changes from the outside (colour picker, reset), the
  // draft is adjusted during render rather than in an effect.
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value);
  }

  return (
    <label className="settings-color">
      <span>{label}</span>
      <span className="settings-color-inputs">
        <input type="color" value={isHexColor(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          className="settings-hex"
          value={draft}
          spellCheck={false}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (isHexColor(next)) onChange(next);
          }}
          onBlur={() => setDraft(value)}
        />
      </span>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-number">
      <span>{label}</span>
      <span className="settings-number-input">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const set = <K extends keyof TreeSettings>(key: K, value: TreeSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="settings-panel" ref={ref} role="dialog" aria-label="Einstellungen">
      <h2>Einstellungen</h2>

      <section>
        <Toggle
          label="Vor- und Nachname untereinander"
          checked={settings.stackedName}
          onChange={(v) => set('stackedName', v)}
        />
        <Toggle label="Namen dick" checked={settings.boldNames} onChange={(v) => set('boldNames', v)} />
        <Toggle
          label="Boxgröße dem Namen anpassen"
          checked={settings.autoSize}
          onChange={(v) => set('autoSize', v)}
        />
        {settings.autoSize && (
          <div className="settings-sub">
            <NumberField
              label="Minimale Breite"
              value={settings.minTileWidth}
              min={TILE_WIDTH_MIN}
              max={TILE_WIDTH_MAX}
              suffix="px"
              onChange={(v) => set('minTileWidth', v)}
            />
            <NumberField
              label="Maximale Breite"
              value={settings.maxTileWidth}
              min={TILE_WIDTH_MIN}
              max={TILE_WIDTH_MAX}
              suffix="px"
              onChange={(v) => set('maxTileWidth', v)}
            />
          </div>
        )}
      </section>

      <section>
        <NumberField
          label="Schriftgröße"
          value={settings.fontSize}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          suffix="px"
          onChange={(v) => set('fontSize', v)}
        />
      </section>

      <section>
        <h3>Farben</h3>
        <ColorField label="Männlich" value={settings.maleFill} onChange={(v) => set('maleFill', v)} />
        <ColorField label="Weiblich" value={settings.femaleFill} onChange={(v) => set('femaleFill', v)} />
        <ColorField label="Text männlich" value={settings.maleText} onChange={(v) => set('maleText', v)} />
        <ColorField label="Text weiblich" value={settings.femaleText} onChange={(v) => set('femaleText', v)} />
      </section>

      <div className="settings-footer">
        <button className="secondary" onClick={() => onChange(DEFAULT_SETTINGS)}>
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}
