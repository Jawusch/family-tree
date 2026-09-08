import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { GedcomData } from '../gedcom/types';
import type { LayoutResult } from '../gedcom/layout';
import { getPersonRelations } from '../gedcom/relations';

interface TreeGraphProps {
  data: GedcomData;
  layout: LayoutResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const NODE_RADIUS = 26;

export function TreeGraph({ data, layout, selectedId, onSelect }: TreeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Fit the whole tree into view once it's laid out (or a new file is loaded).
  // The container may still report a zero-sized rect on the very first
  // render after mount (e.g. right after restoring a saved file), so wait
  // for a real, non-zero size via ResizeObserver instead of measuring once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || layout.nodes.length === 0) return;

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

    // Only auto-fit once (the first time we see a real size) so we don't
    // fight the user's own panning/zooming on later window resizes.
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

  const highlighted = useMemo(() => {
    if (!selectedId) return null;
    const rel = getPersonRelations(data, selectedId);
    return new Set<string>([
      selectedId,
      ...rel.parents,
      ...rel.siblings,
      ...rel.spouses,
      ...rel.children,
    ]);
  }, [data, selectedId]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    setTransform((t) => {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newK = Math.min(4, Math.max(0.08, t.k * factor));
      // keep the point under the cursor fixed while zooming
      const worldX = (pointerX - t.x) / t.k;
      const worldY = (pointerY - t.y) / t.k;
      return {
        k: newK,
        x: pointerX - worldX * newK,
        y: pointerY - worldY * newK,
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
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
        <g className="links">
          {layout.links.map((l, i) => {
            const isHighlighted = highlighted && highlighted.has(l.source.id) && highlighted.has(l.target.id);
            return (
              <line
                key={i}
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                className={`link link--${l.kind}${isHighlighted ? ' link--highlight' : ''}`}
              />
            );
          })}
        </g>
        <g className="nodes">
          {layout.nodes.map((n) => {
            const person = data.individuals.get(n.id);
            if (!person) return null;
            const isSelected = n.id === selectedId;
            const isHighlighted = highlighted?.has(n.id) ?? false;
            const dimmed = highlighted !== null && !isHighlighted;
            const years = [person.birth?.date?.match(/\d{4}/)?.[0], person.death?.date?.match(/\d{4}/)?.[0]]
              .filter(Boolean)
              .join('–');

            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                className={`node node--${person.sex}${isSelected ? ' node--selected' : ''}${dimmed ? ' node--dimmed' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(isSelected ? null : n.id);
                }}
              >
                <circle r={NODE_RADIUS} />
                <text className="node-label" y={NODE_RADIUS + 16}>
                  {person.name}
                </text>
                {years && (
                  <text className="node-years" y={NODE_RADIUS + 32}>
                    {years}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
