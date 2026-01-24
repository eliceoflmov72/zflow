import { Injectable, signal, effect, inject, PLATFORM_ID, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Node, Conection } from '../models/fossflow.types';
import { Logger } from '../utils/logger';
import { Quadtree, QuadtreeItem, Rectangle } from '../utils/quadtree';
import { StorageService } from './storage.service';
import { ConnectionService } from './connection.service';

interface NodeItem extends QuadtreeItem {
  node: Node;
}

@Injectable()
export class GridService {
  private platformId = inject(PLATFORM_ID);
  private storageService = inject(StorageService);
  private connectionService = inject(ConnectionService);

  nodes = signal<Node[]>([]);
  connections = signal<Conection[]>([]);
  gridSize = signal({ width: 40, height: 40 });
  limitReached = signal(false);

  // Map for O(1) access by coordinate "x,y" - Synchronous computed signal
  private nodeCoordMap = computed(() => {
    const map = new Map<string, Node>();
    for (const node of this.nodes()) {
      map.set(`${node.position.x},${node.position.y}`, node);
    }
    return map;
  });

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

  // Computed signal for used colors in the grid (nodes and connections)
  usedColors = computed(() => {
    const nodes = this.nodes();
    const connections = this.connections();

    // Default palette
    const defaults = ['#3b82f6', '#FFFFFF', '#e2e8f0', '#1e293b'];
    const colors = new Set<string>(defaults.map((c) => c.toLowerCase()));

    // Collect used colors
    nodes.forEach((n) => {
      if (n.color) colors.add(n.color.toLowerCase());
      if (n.floorColor) colors.add(n.floorColor.toLowerCase());
    });

    connections.forEach((c: Conection) => {
      if (c.color) colors.add(c.color.toLowerCase());
    });

    return Array.from(colors);
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
      Logger.log(`[GridService] Effect running, nodes length: ${nodes.length}`);

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
   * Fast coordinate-based lookup
   */
  getNodeAt(x: number, y: number): Node | undefined {
    return this.nodeCoordMap().get(`${x},${y}`);
  }

  /**
   * Get nodes within the specified bounds using spatial partitioning
   */
  getNodesInBounds(bounds: Rectangle): Node[] {
    const items = this.quadtree.query(bounds);
    return items.map((i) => i.node);
  }

  /**
   * Load initial state from storage
   */
  private loadFromStorage() {
    const savedNodes = this.storageService.loadNodes();
    const savedConns = this.storageService.loadConnections();

    if (savedNodes && savedNodes.length > 0) {
      // Normalize loaded nodes to ensure consistent floorColor format
      const normalizedNodes = savedNodes.map((n) => ({
        ...n,
        floorColor: (n.floorColor || '#ffffff').toLowerCase(),
        color: n.color || '#3b82f6',
        shape3D: n.shape3D || 'isometric-cube.svg',
        active: n.active ?? false,
      }));
      this.nodes.set(normalizedNodes);
    }

    if (savedConns) {
      this.connections.set(savedConns);
    }
  }

  /**
   * Initialize the grid with default nodes
   */
  initializeGrid(width: number, height: number, force = false) {
    // Safety check for malicious or accidental large grid sizes (OOM Protection)
    const MAX_DIM = 250;
    if (width > MAX_DIM || height > MAX_DIM) {
      Logger.warn(`Grid size ${width}x${height} exceeds safety limit of ${MAX_DIM}. Clamping.`);
      width = Math.min(width, MAX_DIM);
      height = Math.min(height, MAX_DIM);
    }

    if (!force && this.nodes().length > 0) return;

    const initialNodes: Node[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        initialNodes.push({
          id: `${x}-${y}`,
          position: { x, y },
          title: `Node ${x},${y}`,
          description: `Description for ${x},${y}`,
          shape3D: 'isometric-cube.svg',
          color: '#3b82f6',
          floorColor: '#ffffff', // Lowercase for consistency
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
    // First clear storage to prevent stale data
    this.storageService.clearStorage();

    // Reset all nodes to default state
    this.nodes.update((nodes) =>
      nodes.map((n) => ({
        ...n,
        active: false,
        color: '#3b82f6',
        floorColor: '#ffffff', // Lowercase for consistency
        shape3D: 'isometric-cube.svg',
      })),
    );
    this.connections.set([]);

    // Save the clean state
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
    return this.paintBatch([{ x, y }], settings);
  }

  /**
   * Paint a rectangular area of nodes
   */
  paintRectangle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    settings: {
      objectEnabled: boolean;
      floorEnabled: boolean;
      shape?: string;
      objectColor?: string;
      floorColor?: string;
    },
  ): boolean {
    const coords: { x: number; y: number }[] = [];
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        coords.push({ x, y });
      }
    }
    return this.paintBatch(coords, settings);
  }

  /**
   * Update a single node
   */
  updateNode(id: string, updates: Partial<Node>) {
    this.updateManyNodes([{ id, changes: updates }]);
  }

  /**
   * Update multiple nodes in batch with strict limit enforcement
   */
  updateManyNodes(updates: { id: string; changes: Partial<Node> }[]): number {
    if (updates.length === 0) return 0;

    const currentNodes = this.nodes();
    let currentLimitCount = this.modifiedNodesCount();
    const finalUpdates: { id: string; changes: Partial<Node> }[] = [];

    for (const update of updates) {
      const node = currentNodes.find((n) => n.id === update.id);
      if (!node) continue;

      const result = this.checkLimitAndCollision(node, update.changes, currentLimitCount);
      if (result.allowed) {
        currentLimitCount = result.newLimitCount;
        finalUpdates.push(update);
      }
    }

    if (finalUpdates.length === 0) return 0;

    const updatesMap = new Map(finalUpdates.map((u) => [u.id, u.changes]));
    this.nodes.update((nodes) =>
      nodes.map((n) => {
        const change = updatesMap.get(n.id);
        return change ? { ...n, ...change } : n;
      }),
    );
    this.storageService.saveState(this.nodes(), this.connections());
    return finalUpdates.length;
  }

  /**
   * Efficiently paint multiple nodes at once
   */
  paintBatch(
    coords: { x: number; y: number }[],
    settings: {
      objectEnabled: boolean;
      floorEnabled: boolean;
      shape?: string;
      objectColor?: string;
      floorColor?: string;
    },
  ): boolean {
    const updates: { id: string; changes: Partial<Node> }[] = [];

    for (const { x, y } of coords) {
      const node = this.getNodeAt(x, y);
      if (!node) continue;

      const changes: Partial<Node> = {};
      let changed = false;

      if (settings.objectEnabled) {
        if (
          !node.active ||
          node.shape3D !== settings.shape ||
          node.color !== settings.objectColor
        ) {
          changes.active = true;
          changes.shape3D = settings.shape;
          changes.color = settings.objectColor;
          changed = true;
        }
      }

      if (settings.floorEnabled) {
        if (node.floorColor !== settings.floorColor) {
          changes.floorColor = settings.floorColor;
          changed = true;
        }
      }

      if (changed) {
        // Collision check for objects
        if (changes.active === true && !node.active) {
          if (this.isTileOccupied(x, y)) {
            continue; // Skip this one, tile is blocked
          }
        }
        updates.push({ id: node.id, changes });
      }
    }

    if (updates.length > 0) {
      const applied = this.updateManyNodes(updates);
      return applied > 0;
    }
    return false;
  }

  /**
   * Internal limit check for updateManyNodes
   */
  private checkLimitAndCollision(
    node: Node,
    changes: Partial<Node>,
    currentLimitCount: number,
  ): { allowed: boolean; newLimitCount: number } {
    const wasModified = this.isModified(node);
    const willBeModified = this.willBeModified(node, changes);

    // Collision check for objects
    if (changes.active === true && !node.active) {
      if (this.isTileOccupied(node.position.x, node.position.y)) {
        console.warn('Cannot place object: Tile occupied by a connection');
        return { allowed: false, newLimitCount: currentLimitCount };
      }
    }

    let newLimitCount = currentLimitCount;
    if (!wasModified && willBeModified) {
      if (currentLimitCount < 60) {
        newLimitCount++;
        return { allowed: true, newLimitCount };
      } else {
        console.warn('Limit of 60 modified nodes reached');
        this.limitReached.set(true);
        return { allowed: false, newLimitCount };
      }
    } else if (wasModified && !willBeModified) {
      newLimitCount--;
    }

    return { allowed: true, newLimitCount };
  }

  private isModified(node: Node): boolean {
    return !!(node.active || (node.floorColor && node.floorColor.toLowerCase() !== '#ffffff'));
  }

  private willBeModified(node: Node, updates: Partial<Node>): boolean {
    const active = updates.active !== undefined ? updates.active : node.active;
    const floorColor = updates.floorColor !== undefined ? updates.floorColor : node.floorColor;
    return !!(active || (floorColor && floorColor.toLowerCase() !== '#ffffff'));
  }

  /**
   * Centralized logic to check if a cell is occupied by an object or a connection
   */
  isTileOccupied(x: number, y: number): boolean {
    // 1. Check if there is an active object at this tile
    const node = this.getNodeAt(x, y);
    if (node && node.active) return true;

    // 2. Check if there is a connection path passing through this tile
    return this.connectionService.isTileOccupiedByConnection(
      x,
      y,
      this.connections(),
      this.nodes(),
    );
  }

  /**
   * Set nodes directly (used by history service)
   */
  setNodes(nodes: Node[]) {
    this.nodes.set(nodes);
  }

  /**
   * Set connections directly (used by connection service and history service)
   */
  setConnections(connections: Conection[]) {
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

    const existing = this.connections().some((c: Conection) => {
      const same = c.fromId === fromId && c.toId === toId;
      const reverse = !directed && c.fromId === toId && c.toId === fromId;
      return same || reverse;
    });
    if (existing) {
      console.debug('[zflow][grid] addConnection blocked: duplicate connection', { fromId, toId });
      return '';
    }

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
        ? customPath.filter((p: { x: number; y: number }, i: number) => {
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

    const fromDegree = this.connections().filter(
      (c: Conection) => c.fromId === fromId || c.toId === fromId,
    ).length;
    const toDegree = this.connections().filter(
      (c: Conection) => c.fromId === toId || c.toId === toId,
    ).length;

    if (
      (fromNode &&
        typeof fromNode.maxConnections === 'number' &&
        fromDegree >= fromNode.maxConnections) ||
      (toNode && typeof toNode.maxConnections === 'number' && toDegree >= toNode.maxConnections)
    ) {
      console.debug('[zflow][grid] addConnection blocked: maxConnections reached', {
        fromId,
        toId,
        fromDegree,
        toDegree,
        fromMax: fromNode?.maxConnections,
        toMax: toNode?.maxConnections,
      });
      return '';
    }

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
    this.connections.update((conns: Conection[]) => [...conns, newConnection]);
    this.storageService.saveState(this.nodes(), this.connections());
    return newConnection.id;
  }

  /**
   * Update a connection using ConnectionService
   */
  updateConnection(id: string, updates: Partial<Conection>) {
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
