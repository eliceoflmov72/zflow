import { Injectable, signal, computed, effect } from '@angular/core';
import { FossFlowNode, FossFlowConnection, FossFlowState } from '../models/fossflow.types';
import { Quadtree, QuadtreeItem, Rectangle } from '../utils/quadtree';

interface NodeItem extends QuadtreeItem {
  node: FossFlowNode;
}

@Injectable()
export class GridService {
  nodes = signal<FossFlowNode[]>([]);
  connections = signal<FossFlowConnection[]>([]);
  gridSize = signal({ width: 40, height: 40 });
  
  // Spatial Partitioning (Task 7): Quadtree for optimized visibility queries
  private quadtree = new Quadtree<NodeItem>({ x: -5000, y: -5000, width: 10000, height: 10000 });

  selectedNodeIds = signal<string[]>([]);
  selectedConnectionId = signal<string | null>(null);
  // selectedNodeId (single) for backward compat / ease of use in single-selection contexts
  selectedNodeId = computed(() =>
    this.selectedNodeIds().length > 0 ? this.selectedNodeIds()[0] : null,
  );

  selectNode(id: string | null, multi = false) {
    if (id === null) {
      this.selectedNodeIds.set([]);
      return;
    }

    this.selectedConnectionId.set(null); // Clear connection selection

    if (multi) {
      this.selectedNodeIds.update((ids) => {
        if (ids.includes(id)) {
          return ids.filter((existing) => existing !== id);
        }
        return [...ids, id];
      });
    } else {
      this.selectedNodeIds.set([id]);
    }
  }

  setSelection(ids: string[]) {
    this.selectedNodeIds.set(ids);
    if (ids.length > 0) this.selectedConnectionId.set(null);
  }

  selectConnection(id: string | null) {
    this.selectedConnectionId.set(id);
    if (id) this.selectedNodeIds.set([]);
  }

  private history: string[] = [];
  private future: string[] = [];

  constructor() {
    this.loadFromStorage();
    
    // Maintain Quadtree
    effect(() => {
      const nodes = this.nodes();
      this.quadtree.clear();
      for (const node of nodes) {
        this.quadtree.insert({
          x: node.position.x,
          y: node.position.y,
          id: node.id,
          node: node
        });
      }
    });
  }

  getNodesInBounds(bounds: Rectangle): FossFlowNode[] {
    const items = this.quadtree.query(bounds);
    return items.map(i => i.node);
  }

  private loadFromStorage() {
    const savedNodes = localStorage.getItem('zflow_nodes');
    const savedConns = localStorage.getItem('zflow_connections');

    if (savedNodes) {
      try {
        this.nodes.set(JSON.parse(savedNodes));
      } catch (e) {
        console.error('Failed to parse saved nodes', e);
      }
    }

    if (savedConns) {
      try {
        this.connections.set(JSON.parse(savedConns));
      } catch (e) {
        console.error('Failed to parse saved connections', e);
      }
    }
  }

  private saveToStorage() {
    localStorage.setItem('zflow_nodes', JSON.stringify(this.nodes()));
    localStorage.setItem('zflow_connections', JSON.stringify(this.connections()));
  }

  pushState() {
    const state = JSON.stringify({
      nodes: this.nodes(),
      connections: this.connections(),
    });
    // Only push if different from last
    if (this.history.length > 0 && this.history[this.history.length - 1] === state) return;

    this.history.push(state);
    // Optimization (Task 8): Reduce history size to save memory
    if (this.history.length > 20) this.history.shift(); // Limit history
    this.future = []; // Clear future on new action
  }

  undo() {
    if (this.history.length === 0) return;

    const currentState = JSON.stringify({
      nodes: this.nodes(),
      connections: this.connections(),
    });
    this.future.push(currentState);

    const prevState = JSON.parse(this.history.pop()!);
    this.nodes.set(prevState.nodes);
    this.connections.set(prevState.connections);
    this.saveToStorage();
  }

  redo() {
    if (this.future.length === 0) return;

    const currentState = JSON.stringify({
      nodes: this.nodes(),
      connections: this.connections(),
    });
    this.history.push(currentState);

    const nextState = JSON.parse(this.future.pop()!);
    this.nodes.set(nextState.nodes);
    this.connections.set(nextState.connections);
    this.saveToStorage();
  }

  initializeGrid(width: number, height: number, force = false) {
    if (!force && this.nodes().length > 0) return;
    this.pushState();

    const initialNodes: FossFlowNode[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        initialNodes.push({
          id: `${x}-${y}`,
          position: { x, y },
          title: `Node ${x},${y}`,
          description: `Description for ${x},${y}`,
          shape3D: 'isometric-cube.svg',
          color: '#3b82f6',
          floorColor: '#FFFFFF',
          active: false,
          maxConnections: 4,
        });
      }
    }

    // Set a few active ones to start
    initialNodes[2 * width + 2].active = true;
    initialNodes[4 * width + 4].active = true;

    this.nodes.set(initialNodes);
    this.connections.set([]);
    this.gridSize.set({ width, height });
    this.saveToStorage();
  }

  updateNode(id: string, updates: Partial<FossFlowNode>) {
    this.pushState();
    // If we are activating a node, ensure it doesn't collide with a connection
    if (updates.active === true) {
      const node = this.nodes().find((n) => n.id === id);
      // Only block if it's currently INACTIVE and the tile is occupied
      if (
        node &&
        !node.active &&
        this.isTileOccupiedByConnection(node.position.x, node.position.y)
      ) {
        console.warn('Cannot place object: Tile occupied by a connection');
        return;
      }
    }

    this.nodes.update((nodes) => nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)));
    // Auto-recalculate removed
    this.saveToStorage();
  }

  updateManyNodes(updates: { id: string; changes: Partial<FossFlowNode> }[]) {
    this.pushState();
    // Create a map for faster lookup
    const updatesMap = new Map(updates.map((u) => [u.id, u.changes]));

    this.nodes.update((nodes) =>
      nodes.map((n) => {
        const change = updatesMap.get(n.id);
        if (change) {
          // Connection collision check logic could go here if needed, but for bulk paint (likely overriding) we might skip strict check or apply it.
          // For now assuming paint tool forces updates.
          return { ...n, ...change };
        }
        return n;
      }),
    );
    this.saveToStorage();
  }

  clearGrid() {
    this.pushState();
    this.nodes.update((nodes) =>
      nodes.map((n) => ({
        ...n,
        active: false,
        color: '#3b82f6',
        floorColor: '#FFFFFF',
        shape3D: 'isometric-cube.svg',
      })),
    );
    this.connections.set([]);
    this.connections.set([]);
    this.selectedNodeIds.set([]);
    this.selectedConnectionId.set(null);
    this.saveToStorage();
  }

  isTileOccupiedByConnection(x: number, y: number): boolean {
    return this.connections().some((conn) => {
      const path = conn.path || this.calculateDefaultPath(conn);
      return path?.some((p) => Math.round(p.x) === x && Math.round(p.y) === y);
    });
  }

  private calculateDefaultPath(conn: FossFlowConnection): { x: number; y: number }[] {
    const from = this.nodes().find((n) => n.id === conn.fromId);
    const to = this.nodes().find((n) => n.id === conn.toId);
    if (!from || !to) return [];
    // Just a fallback Manhattan path for occupancy check if no A* path stored
    const path = [];
    let currX = from.position.x;
    let currY = from.position.y;
    while (currX !== to.position.x) {
      path.push({ x: currX, y: currY });
      currX += Math.sign(to.position.x - currX);
    }
    while (currY !== to.position.y) {
      path.push({ x: currX, y: currY });
      currY += Math.sign(to.position.y - currY);
    }
    path.push({ x: to.position.x, y: to.position.y });
    return path;
  }

  /**
   * Algorithm for Automatic Connections
   * 1. Only active nodes are connected
   * 2. Proximity-based: connects to the nearest available neighbors
   * 3. Capacity-aware: respects node.maxConnections
   */
  recalculateConnections() {
    // Auto-connectivity disabled by user request.
    // Connections must be created manually.
  }

  addManualConnection(
    fromId: string,
    toId: string,
    directed = false,
    customPath?: { x: number; y: number }[],
    style: 'straight' | 'rounded' = 'straight',
    lineType: 'solid' | 'dashed' = 'solid',
  ) {
    this.pushState();
    const id = `manual-${Math.random().toString(36).substr(2, 9)}`;
    const fromNode = this.nodes().find((n) => n.id === fromId);
    const toNode = this.nodes().find((n) => n.id === toId);

    let path = customPath;
    if (!path && fromNode && toNode) {
      path = this.findPath(fromNode, toNode) || undefined;
    }

    this.connections.update((conns) => [
      ...conns,
      { id, fromId, toId, directed, color: '#3b82f6', path, style, lineType },
    ]);
    this.saveToStorage();
  }

  // A* Implementation to avoid active nodes (obstacles)
  private findPath(from: FossFlowNode, to: FossFlowNode): { x: number; y: number }[] | null {
    const start = from.position;
    const end = to.position;
    const openSet: { x: number; y: number; g: number; f: number; parent: any }[] = [];
    const closedSet = new Set<string>();

    openSet.push({ ...start, g: 0, f: this.heuristic(start, end), parent: null });

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;
      if (current.x === end.x && current.y === end.y) {
        // Reconstruct path
        const path = [];
        let temp: any = current;
        while (temp) {
          path.push({ x: temp.x, y: temp.y });
          temp = temp.parent;
        }
        return path.reverse();
      }

      closedSet.add(`${current.x},${current.y}`);

      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ];

      for (const neighbor of neighbors) {
        if (closedSet.has(`${neighbor.x},${neighbor.y}`)) continue;

        // Obstacle check: is tile active and NOT the start or end?
        const isObstacle = this.nodes().some(
          (n) =>
            n.active &&
            n.position.x === neighbor.x &&
            n.position.y === neighbor.y &&
            n.id !== from.id &&
            n.id !== to.id,
        );
        if (isObstacle) continue;

        // Out of bounds
        const size = this.gridSize();
        if (
          neighbor.x < 0 ||
          neighbor.x >= size.width ||
          neighbor.y < 0 ||
          neighbor.y >= size.height
        )
          continue;

        const gScore = current.g + 1;
        let existing = openSet.find((o) => o.x === neighbor.x && o.y === neighbor.y);

        if (!existing) {
          openSet.push({
            ...neighbor,
            g: gScore,
            f: gScore + this.heuristic(neighbor, end),
            parent: current,
          });
        } else if (gScore < existing.g) {
          existing.g = gScore;
          existing.f = gScore + this.heuristic(neighbor, end);
          existing.parent = current;
        }
      }
    }
    return null;
  }

  private heuristic(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  updateConnection(id: string, updates: Partial<FossFlowConnection>) {
    this.pushState();
    this.connections.update((conns) => conns.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    this.saveToStorage();
  }

  removeConnection(id: string) {
    this.pushState();
    this.connections.update((conns) => conns.filter((c) => c.id !== id));
    if (this.selectedConnectionId() === id) {
      this.selectedConnectionId.set(null);
    }
    this.saveToStorage();
  }
}
