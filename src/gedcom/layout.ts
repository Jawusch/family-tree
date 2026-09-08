import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GedcomData } from './types';
import { buildRelationGraph, type GraphLink } from './relations';

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  generation: number;
}

export interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  kind: GraphLink['kind'];
}

export interface LayoutResult {
  nodes: LayoutNode[];
  links: LayoutLink[];
  width: number;
  height: number;
}

const GEN_HEIGHT = 220;
const NODE_SPACING = 90;
const SIM_TICKS = 400;

/**
 * Lays every individual out on one canvas: generation determines the row
 * (y), a force simulation (link/charge/collide) spreads people within and
 * across generations (x) so that spouses stay adjacent and families cluster
 * together instead of overlapping.
 */
export function computeLayout(data: GedcomData): LayoutResult {
  const { nodes: graphNodes, links: graphLinks } = buildRelationGraph(data);

  if (graphNodes.length === 0) {
    return { nodes: [], links: [], width: 1000, height: 600 };
  }

  const maxGen = Math.max(...graphNodes.map((n) => n.generation));
  const width = Math.max(1200, Math.sqrt(graphNodes.length) * NODE_SPACING * 6);

  const nodes: LayoutNode[] = graphNodes.map((n, i) => ({
    id: n.id,
    generation: n.generation,
    x: width / 2 + ((i % 17) - 8) * 40,
    y: n.generation * GEN_HEIGHT + 80,
  }));

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const simLinks: SimulationLinkDatum<LayoutNode>[] = graphLinks.map((l) => ({
    source: l.source,
    target: l.target,
    kind: l.kind,
  })) as (SimulationLinkDatum<LayoutNode> & { kind: GraphLink['kind'] })[];

  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink<LayoutNode, SimulationLinkDatum<LayoutNode>>(simLinks)
        .id((d) => d.id)
        .distance((l) => ((l as unknown as { kind: string }).kind === 'spouse' ? 60 : 110))
        .strength((l) => ((l as unknown as { kind: string }).kind === 'spouse' ? 0.9 : 0.3)),
    )
    .force('charge', forceManyBody().strength(-180))
    .force('collide', forceCollide(46))
    .force('x', forceX(width / 2).strength(0.02))
    .force('y', forceY<LayoutNode>((d) => d.generation * GEN_HEIGHT + 80).strength(1))
    .stop();

  for (let i = 0; i < SIM_TICKS; i++) simulation.tick();

  const height = (maxGen + 1) * GEN_HEIGHT + 160;

  const links: LayoutLink[] = [];
  for (const l of graphLinks) {
    const source = nodeById.get(l.source);
    const target = nodeById.get(l.target);
    if (source && target) links.push({ source, target, kind: l.kind });
  }

  return { nodes, links, width, height };
}
