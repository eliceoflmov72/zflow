import { Injectable, signal, effect, inject } from '@angular/core';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';
import { Quadtree, QuadtreeItem, Rectangle } from '../utils/quadtree';
import { StorageService } from './storage.service';
import { ConnectionService } from './connection.service';

interface NodeItem extends QuadtreeItem {
  node: FossFlowNode;
}

@Injectable()
export class GridService {
  private storageService = inject(StorageService);
  private connectionService = inject(ConnectionService);

  nodes = signal<FossFlowNode[]>([]);
  connections = signal<FossFlowConnection[]>([]);
  gridSize = signal({ width: 40, height: 40 });

  // Spatial Partitioning (Task 7): Quadtree for optimized visibility queries
  private quadtree = new Quadtree<NodeItem>({ x: -5000, y: -5000, width: 10000, height: 10000 });

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
          node: node,
        });
      }
    });
  }

  /**
   * Get nodes within the specified bounds using spatial partitioning
   */
  getNodesInBounds(bounds: Rectangle): FossFlowNode[] {
    const items = this.quadtree.query(bounds);
    return items.map((i) => i.node);
  }

  /**
   * Load initial state from storage
   */
  private loadFromStorage() {
    const savedNodes = this.storageService.loadNodes();
    const savedConns = this.storageService.loadConnections();

    if (savedNodes) {
      this.nodes.set(savedNodes);
    }

    if (savedConns) {
      this.connections.set(savedConns);
    }
  }

  /**
   * Initialize the grid with default nodes
   */
  initializeGrid(width: number, height: number, force = false) {
    if (!force && this.nodes().length > 0) return;

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
    this.storageService.saveState(this.nodes(), this.connections());
  }

  /**
   * Clear the grid, resetting all nodes to default state
   */
  clearGrid() {
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
    this.storageService.saveState(this.nodes(), this.connections());
  }

  /**
   * Update a single node
   */
  updateNode(id: string, updates: Partial<FossFlowNode>) {
    // If we are activating a node, ensure it doesn't collide with a connection
    if (updates.active === true) {
      const node = this.nodes().find((n) => n.id === id);
      // Only block if it's currently INACTIVE and the tile is occupied
      if (
        node &&
        !node.active &&
        this.connectionService.isTileOccupiedByConnection(
          node.position.x,
          node.position.y,
          this.connections(),
          this.nodes(),
        )
      ) {
        console.warn('Cannot place object: Tile occupied by a connection');
        return;
      }
    }

    this.nodes.update((nodes) => nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)));
    this.storageService.saveState(this.nodes(), this.connections());
  }

  /**
   * Update multiple nodes in batch
   */
  updateManyNodes(updates: { id: string; changes: Partial<FossFlowNode> }[]) {
    const updatesMap = new Map(updates.map((u) => [u.id, u.changes]));

    this.nodes.update((nodes) =>
      nodes.map((n) => {
        const change = updatesMap.get(n.id);
        if (change) {
          return { ...n, ...change };
        }
        return n;
      }),
    );
    this.storageService.saveState(this.nodes(), this.connections());
  }

  /**
   * Set nodes directly (used by history service)
   */
  setNodes(nodes: FossFlowNode[]) {
    this.nodes.set(nodes);
  }

  /**
   * Set connections directly (used by connection service and history service)
   */
  setConnections(connections: FossFlowConnection[]) {
    this.connections.set(connections);
  }

  /**
   * Add a connection using ConnectionService
   */
  addConnection(
    fromId: string,
    toId: string,
    directed = false,
    customPath?: { x: number; y: number }[],
    style: 'straight' | 'rounded' = 'straight',
    lineType: 'solid' | 'dashed' = 'solid',
  ): string {
    const newConnection = this.connectionService.createConnection(
      fromId,
      toId,
      this.nodes(),
      this.gridSize(),
      directed,
      customPath,
      style,
      lineType,
    );
    this.connections.update((conns) => [...conns, newConnection]);
    this.storageService.saveState(this.nodes(), this.connections());
    return newConnection.id;
  }

  /**
   * Update a connection using ConnectionService
   */
  updateConnection(id: string, updates: Partial<FossFlowConnection>) {
    const updated = this.connectionService.updateConnection(id, updates, this.connections());
    this.connections.set(updated);
    this.storageService.saveState(this.nodes(), this.connections());
  }

  /**
   * Remove a connection using ConnectionService
   */
  removeConnection(id: string) {
    const updated = this.connectionService.removeConnection(id, this.connections());
    this.connections.set(updated);
    this.storageService.saveState(this.nodes(), this.connections());
  }
}
