import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { GedcomData } from '../gedcom/types';
import type { GridLayout } from '../gedcom/gridLayout';
import type { TreeSettings } from '../tree/settings';
import type { TileVisuals } from '../tree/tileVisuals';
import { FONT_STACK } from '../tree/tileVisuals';
import {
  buildRenderTiles,
  mutedColor,
  CONNECTOR_COLOR,
  CONNECTOR_WIDTH,
  TILE_RADIUS,
} from '../tree/renderModel';

interface TreeGraphProps {
  data: GedcomData;
  layout: GridLayout;
  visuals: TileVisuals;
  settings: TreeSettings;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const DRAG_THRESHOLD = 4;

export function TreeGraph({
  data,
  layout,
  visuals,
  settings,
  selectedIds,
  onToggleSelect,
}: TreeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const didDrag = useRef(false);

  const renderTiles = useMemo(
    () => buildRenderTiles(data, layout, visuals, settings),
    [data, layout, visuals, settings],
  );

  // Fit the whole tree into view once it's laid out (or a new file is
  // loaded). The container may still report a zero-sized rect on the very
  // first render after mount, so wait for a real size via ResizeObserver.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || layout.tiles.size === 0) return;

    const fit = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const k = Math.min(1, (width - 80) / layout.width, (height - 80) / layout.height);
      const safeK = Number.isFinite(k) && k > 0 ? k : 1;
      setTransform({
        x: (width - layout.width * safeK) / 2,
        y: 40,
        k: safeK,
      });
    };

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        fit(width, height);
        observer.disconnect();
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [layout]);

  // React registers its wheel listener passively, so preventDefault() inside
  // an onWheel prop is ignored and logs a console error. Attach the listener
  // ourselves with { passive: false } so zooming doesn't scroll the page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newK = Math.min(4, Math.max(0.08, t.k * factor));
        const worldX = (pointerX - t.x) / t.k;
        const worldY = (pointerY - t.y) / t.k;
        return {
          k: newK,
          x: pointerX - worldX * newK,
          y: pointerY - worldY * newK,
        };
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      didDrag.current = false;
      dragState.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
    },
    [transform],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) didDrag.current = true;
    // Read the drag origin here rather than inside the updater: React can
    // run the updater again later (e.g. re-rendering in StrictMode), by
    // which time the drag has ended and the ref is back to null.
    const { origX, origY } = drag;
    setTransform((t) => ({ ...t, x: origX + dx, y: origY + dy }));
  }, []);

  const stopDrag = useCallback(() => {
    dragState.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="tree-graph"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <svg
        width={layout.width}
        height={layout.height}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
          transformOrigin: '0 0',
        }}
      >
        <g className="connectors" stroke={CONNECTOR_COLOR} strokeWidth={CONNECTOR_WIDTH} fill="none">
          {layout.connectors.map((c) => (
            <g key={c.familyId}>
              {c.spouseLine && (
                <line x1={c.spouseLine.x1} y1={c.spouseLine.y1} x2={c.spouseLine.x2} y2={c.spouseLine.y2} />
              )}
              {c.path && <path d={c.path} />}
            </g>
          ))}
        </g>
        <g className="tiles">
          {renderTiles.map(({ pos, visual, fill, stroke, textColor }) => {
            const isSelected = selectedIds.has(pos.id);
            const muted = mutedColor(textColor);

            return (
              <g
                key={pos.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className={`tile${isSelected ? ' tile--selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!didDrag.current) onToggleSelect(pos.id);
                }}
              >
                <rect
                  width={visual.width}
                  height={pos.h}
                  rx={TILE_RADIUS}
                  className="tile-rect"
                  fill={fill}
                  stroke={isSelected ? undefined : stroke}
                  strokeWidth={isSelected ? undefined : 1.5}
                />
                {visual.lines.map((line, i) => (
                  <text
                    key={i}
                    x={visual.width / 2}
                    y={line.y}
                    textAnchor="middle"
                    fontFamily={FONT_STACK}
                    fontSize={line.fontSize}
                    fontWeight={line.bold ? 800 : line.muted ? 400 : 600}
                    fill={line.muted ? muted : textColor}
                    pointerEvents="none"
                  >
                    {line.text}
                  </text>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
