/** User-adjustable rendering options for the tree (settings panel). */
export interface TreeSettings {
  /** Show the surname on its own line below the given name. */
  stackedName: boolean;
  /** Render names in a heavier weight. */
  boldNames: boolean;
  /** Size each tile to fit its own name instead of using one fixed width. */
  autoSize: boolean;
  /** Bounds for `autoSize`. */
  minTileWidth: number;
  maxTileWidth: number;
  fontSize: number;
  maleFill: string;
  femaleFill: string;
  maleText: string;
  femaleText: string;
}

export const DEFAULT_SETTINGS: TreeSettings = {
  stackedName: false,
  boldNames: false,
  autoSize: false,
  minTileWidth: 120,
  maxTileWidth: 260,
  fontSize: 13,
  maleFill: '#eaf1ff',
  femaleFill: '#ffeef5',
  maleText: '#1c1f24',
  femaleText: '#1c1f24',
};

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 28;
export const TILE_WIDTH_MIN = 60;
export const TILE_WIDTH_MAX = 600;

const STORAGE_KEY = 'family-tree.settings';

export function loadSettings(): TreeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TreeSettings>;
    // Merge onto the defaults so settings added in a later version don't
    // come back undefined for someone with a stored older object.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: TreeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings just won't persist.
  }
}

// --- Colour helpers -------------------------------------------------------

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Border colour for a tile, derived from its fill: same hue, noticeably
 * darker and a little more saturated - so a custom fill always comes with a
 * matching outline instead of needing its own setting.
 */
export function borderColor(fill: string): string {
  if (!isHexColor(fill)) return '#cfd3d9';
  const [r, g, b] = hexToRgb(fill).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const nl = Math.max(0, l - 0.18);
  const ns = Math.min(1, s * 1.15);

  const c = (1 - Math.abs(2 * nl - 1)) * ns;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = nl - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}
