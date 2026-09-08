import { useRef, useState, useCallback, useEffect } from 'react';
import type { GedcomData } from '../gedcom/types';
import { TILE_WIDTH, TILE_HEIGHT, type GridLayout } from '../gedcom/gridLayout';

interface TreeGraphProps {
  data: GedcomData;
  layout: GridLayout;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleteOne: (id: string) => void;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const DRAG_THRESHOLD = 4;

function truncate(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function TreeGraph({ data, layout, selectedIds, onToggleSelect, onDeleteOne }: TreeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const didDrag = useRef(false);

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

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
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
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) didDrag.current = true;
    setTransform((t) => ({ ...t, x: dragState.current!.origX + dx, y: dragState.current!.origY + dy }));
  }, []);

  const stopDrag = useCallback(() => {
    dragState.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="tree-graph"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <svg
        width={layout.width}
        height={layout.height}
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`, transformOrigin: '0 0' }}
      >
        <g className="connectors">
          {layout.connectors.map((c) => (
            <g key={c.familyId}>
              {c.spouseLine && (
                <line
                  x1={c.spouseLine.x1}
                  y1={c.spouseLine.y1}
                  x2={c.spouseLine.x2}
                  y2={c.spouseLine.y2}
                  className="connector-line"
                />
              )}
              {c.path && <path d={c.path} className="connector-line" fill="none" />}
            </g>
          ))}
        </g>
        <g className="tiles">
          {[...layout.tiles.values()].map((pos) => {
            const person = data.individuals.get(pos.id);
            if (!person) return null;
            const isSelected = selectedIds.has(pos.id);
            const years = [person.birth?.date?.match(/\d{4}/)?.[0], person.death?.date?.match(/\d{4}/)?.[0]]
              .filter(Boolean)
              .join(' – ');

            return (
              <g
                key={pos.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className={`tile tile--${person.sex}${isSelected ? ' tile--selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!didDrag.current) onToggleSelect(pos.id);
                }}
              >
                <rect width={TILE_WIDTH} height={TILE_HEIGHT} rx={6} className="tile-rect" />
                <text className="tile-name" x={TILE_WIDTH / 2} y={TILE_HEIGHT / 2 - 6}>
                  {truncate(person.name)}
                </text>
                <text className="tile-dates" x={TILE_WIDTH / 2} y={TILE_HEIGHT / 2 + 14}>
                  {years || '—'}
                </text>
                <g
                  className="tile-delete"
                  transform={`translate(${TILE_WIDTH - 18}, 2)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteOne(pos.id);
                  }}
                >
                  <circle r={9} cx={8} cy={8} />
                  <line x1={4.5} y1={4.5} x2={11.5} y2={11.5} />
                  <line x1={11.5} y1={4.5} x2={4.5} y2={11.5} />
                </g>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
