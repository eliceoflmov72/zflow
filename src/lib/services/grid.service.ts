import { Injectable, signal, effect, inject, PLATFORM_ID, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';
import { Quadtree, QuadtreeItem, Rectangle } from '../utils/quadtree';
import { StorageService } from './storage.service';
import { ConnectionService } from './connection.service';

interface NodeItem extends QuadtreeItem {
  node: FossFlowNode;
}

@Injectable()
export class GridService {
  private platformId = inject(PLATFORM_ID);
  private storageService = inject(StorageService);
  private connectionService = inject(ConnectionService);

  nodes = signal<FossFlowNode[]>([]);
  connections = signal<FossFlowConnection[]>([]);
  gridSize = signal({ width: 40, height: 40 });

  // Map for O(1) access by coordinate "x,y"
  private nodeCoordMap = new Map<string, FossFlowNode>();

  // Computed signal for only active nodes to optimize rendering
  activeNodes = computed(() => {
    return this.nodes().filter((n) => n.active);
  });

  // Count nodes that count towards the "edit limit" (active objects or painted floors)
  modifiedNodesCount = computed(() => {
    return this.nodes().filter(
      (n) => n.active || (n.floorColor && n.floorColor.toLowerCase() !== '#ffffff'),
    ).length;
  });

  // Spatial Partitioning: Quadtree for optimized visibility queries
  private quadtree = new Quadtree<NodeItem>({ x: -5000, y: -5000, width: 10000, height: 10000 });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadFromStorage();
    }

    // Maintain Quadtree and Coordinate Map
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const nodes = this.nodes();

      // Update local cache map
      const newMap = new Map<string, FossFlowNode>();
      this.quadtree.clear();

      for (const node of nodes) {
        newMap.set(`${node.position.x},${node.position.y}`, node);
        this.quadtree.insert({
          x: node.position.x,
          y: node.position.y,
          id: node.id,
          node: node,
        });
      }
      this.nodeCoordMap = newMap;
    });
  }

  /**
   * Fast coordinate-based lookup
   */
  getNodeAt(x: number, y: number): FossFlowNode | undefined {
    return this.nodeCoordMap.get(`${x},${y}`);
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
   * Paint a node with logic for object/floor updates and collision check.
   * Returns true if a mutation actually occurred.
   */
  paintNode(
    x: number,
    y: number,
    settings: {
      objectEnabled: boolean;
      floorEnabled: boolean;
      shape?: string;
      objectColor?: string;
      floorColor?: string;
    },
  ): boolean {
    const node = this.getNodeAt(x, y);
    if (!node) return false;

    const updates: Partial<FossFlowNode> = {};
    let changed = false;

    // Check if adding an object would exceed limit
    const isAddingObject = settings.objectEnabled && !node.active;
    const isPaintingFloor =
      settings.floorEnabled &&
      (node.floorColor || '#ffffff').toLowerCase() === '#ffffff' &&
      (settings.floorColor || '#ffffff').toLowerCase() !== '#ffffff';

    // If it's a completely new modification (neither object nor floor previously modified)
    const isNodeCurrentlyModified =
      node.active || (node.floorColor && node.floorColor.toLowerCase() !== '#ffffff');
    const willBeModified =
      settings.objectEnabled ||
      (settings.floorEnabled && (settings.floorColor || '#ffffff').toLowerCase() !== '#ffffff');

    if (!isNodeCurrentlyModified && willBeModified) {
      if (this.modifiedNodesCount() >= 60) {
        console.warn('Cannot edit node: Limit of 60 modified nodes reached');
        return false;
      }
    }

    if (settings.objectEnabled) {
      if (!node.active || node.shape3D !== settings.shape || node.color !== settings.objectColor) {
        updates.active = true;
        updates.shape3D = settings.shape;
        updates.color = settings.objectColor;
        changed = true;
      }
    }

    if (settings.floorEnabled) {
      if (node.floorColor !== settings.floorColor) {
        updates.floorColor = settings.floorColor;
        changed = true;
      }
    }

    if (changed) {
      this.updateNode(node.id, updates);
    }
    return changed;
  }

  /**
   * Update a single node
   */
  updateNode(id: string, updates: Partial<FossFlowNode>) {
    const node = this.nodes().find((n) => n.id === id);
    if (!node) return;

    // Limit check for manual updates (from sidebars)
    const isCurrentlyModified =
      node.active || (node.floorColor && node.floorColor.toLowerCase() !== '#ffffff');
    const willBeActive = updates.active !== undefined ? updates.active : node.active;
    const willHavePaintedFloor =
      updates.floorColor !== undefined
        ? updates.floorColor.toLowerCase() !== '#ffffff'
        : node.floorColor && node.floorColor.toLowerCase() !== '#ffffff';

    const willBeModified = willBeActive || willHavePaintedFloor;

    if (!isCurrentlyModified && willBeModified && this.modifiedNodesCount() >= 60) {
      console.warn('Cannot update node: Limit of 60 modified nodes reached');
      return;
    }

    // If we are activating a node, ensure it doesn't collide with a connection
    if (updates.active === true) {
      // Only block if it's currently INACTIVE and the tile is occupied
      if (
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
    // State is saved by the effect that watches this.nodes()
    this.storageService.saveState(this.nodes(), this.connections());
  }

  /**
   * Update multiple nodes in batch
   */
  updateManyNodes(updates: { id: string; changes: Partial<FossFlowNode> }[]) {
    if (updates.length === 0) return;

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
    color?: string,
    direction?: 'forward' | 'reverse' | 'bi',
    allowDiagonals: boolean = true,
  ): string {
    if (!fromId || !toId) {
      console.debug('[zflow][grid] addConnection blocked: invalid endpoints', { fromId, toId });
      return '';
    }

    /* 
    const existing = this.connections().some((c) => {
      const same = c.fromId === fromId && c.toId === toId;
      const reverse = !directed && c.fromId === toId && c.toId === fromId;
      return same || reverse;
    });
    if (existing) {
      console.debug('[zflow][grid] addConnection blocked: duplicate connection', { fromId, toId });
      return '';
    }
    */

    const nodes = this.nodes();
    const fromNode = nodes.find((n) => n.id === fromId);
    const toNode = nodes.find((n) => n.id === toId);
    // We allow fromId/toId to be 'point-x-y' strings if nodes are null
    // This supports starting/ending at arbitrary tile coordinates
    const fromPos = fromNode?.position || this.parsePointId(fromId);
    const toPos = toNode?.position || this.parsePointId(toId);

    if (!fromPos || !toPos) {
      console.debug('[zflow][grid] addConnection blocked: missing position', { fromId, toId });
      return '';
    }

    // Block direct connection of adjacent nodes (must go around)
    // Skip this check for self-loops (fromId === toId) since ConnectionService handles that case
    if (fromId !== toId) {
      const dx = Math.abs(fromPos.x - toPos.x);
      const dy = Math.abs(fromPos.y - toPos.y);
      const isAdjacent = dx <= 1 && dy <= 1;

      const uniquePoints = customPath
        ? customPath.filter((p, i) => {
            if (i === 0) return true;
            return p.x !== customPath[i - 1].x || p.y !== customPath[i - 1].y;
          })
        : [];

      if (isAdjacent && (!uniquePoints || uniquePoints.length <= 2)) {
        console.warn(
          '[zflow][grid] Blocking direct connection between adjacent nodes. Use waypoints to go around.',
        );
        return '';
      }
    }

    /* 
    const fromDegree = this.connections().filter(
      (c) => c.fromId === fromId || c.toId === fromId,
    ).length;
    const toDegree = this.connections().filter((c) => c.fromId === toId || c.toId === toId).length;
    if (
      (typeof fromNode.maxConnections === 'number' && fromDegree >= fromNode.maxConnections) ||
      (typeof toNode.maxConnections === 'number' && toDegree >= toNode.maxConnections)
    ) {
      console.debug('[zflow][grid] addConnection blocked: maxConnections reached', {
        fromId,
        toId,
        fromDegree,
        toDegree,
        fromMax: fromNode.maxConnections,
        toMax: toNode.maxConnections,
      });
      return '';
    }
    */

    const newConnection = this.connectionService.createConnection(
      fromId,
      toId,
      nodes,
      this.gridSize(),
      directed,
      customPath,
      style,
      lineType,
      color,
      direction,
      true, // Always allow diagonals
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

  private parsePointId(id: string): { x: number; y: number } | null {
    if (!id || !id.startsWith('point-')) return null;
    const parts = id.split('-');
    if (parts.length < 3) return null;
    return { x: parseInt(parts[1], 10), y: parseInt(parts[2], 10) };
  }
}
