import { Injectable, isDevMode } from '@angular/core';
import { Node, Conection } from '../models/zflow.types';
import { Logger } from '../utils/logger';

@Injectable()
export class ConnectionService {
  constructor() {}

  private debugEnabled = false;

  setDebugEnabled(enabled: boolean) {
    this.debugEnabled = enabled;
  }

  private debugLog(message: string, data?: unknown) {
    if (isDevMode()) {
      Logger.debug(`[connection] ${message}`, data);
    }
  }

  /**
   * Check if a tile is occupied by a connection path
   */
  isTileOccupiedByConnection(
    x: number,
    y: number,
    connections: Conection[],
    nodes: Node[],
  ): boolean {
    return connections.some((conn) => {
      const path = conn.path || this.calculateDefaultPath(conn, nodes);
      return path?.some((p) => Math.round(p.x) === x && Math.round(p.y) === y);
    });
  }

  private calculateDefaultPath(conn: Conection, nodes: Node[]): { x: number; y: number }[] {
    const from = nodes.find((n) => n.id === conn.fromId);
    const to = nodes.find((n) => n.id === conn.toId);
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
   * Add a manual connection between two nodes
   * Returns the new connection object
   */
  createConnection(
    fromId: string,
    toId: string,
    nodes: Node[],
    gridSize: { width: number; height: number },
    directed = false,
    customPath?: { x: number; y: number }[],
    style: 'straight' | 'rounded' = 'straight', // Keep original parameters for now, as the diff was ambiguous
    lineType: 'solid' | 'dashed' = 'solid', // Keep original parameters for now
    color?: string,
    direction?: 'forward' | 'reverse' | 'bi',
    allowDiagonals: boolean = true,
  ): Conection {
    if (!fromId || !toId) {
      this.debugLog('createConnection: invalid endpoints', { fromId, toId });
      const id = `manual-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id,
        fromId,
        toId,
        directed,
        direction,
        color: color || '#3b82f6',
        path: customPath,
        style,
        lineType,
      };
    }

    const id = `manual-${Math.random().toString(36).substring(2, 11)}`;
    const fromNode = nodes.find((n) => n.id === fromId);
    const toNode = nodes.find((n) => n.id === toId);

    let path = customPath ? customPath.map((p) => ({ ...p })) : undefined;

    if (fromId === toId && fromNode) {
      if (path && path.length > 2) {
        // Use the manually drawn path for the self-loop (already densified/mapped above)
        path = this.densifyPath(path);
      } else {
        path = this.generateSelfLoopPath(fromNode.position, gridSize);
      }
      return {
        id,
        fromId,
        toId,
        directed,
        direction,
        color: color || '#3b82f6',
        path,
        style,
        lineType,
      };
    }

    if (fromNode && toNode) {
      if (!path) {
        // Respect routing mode or allow diagonals by default for efficiency
        path = this.findPath(fromNode, toNode, nodes, gridSize, allowDiagonals) || undefined;
      } else {
        const densified = this.densifyPath(path);
        const isOnlyEndpoints = path.length <= 2;

        const collides = this.pathCollidesWithNodes(densified, nodes, fromId, toId);
        if (collides) {
          const routed = this.routeThroughWaypoints(path, nodes, gridSize, fromId, toId);
          if (routed) path = routed;
          else path = this.findPath(fromNode, toNode, nodes, gridSize) || densified;
        } else {
          if (style === 'straight' || isOnlyEndpoints) path = densified;
          else path = densified;
        }
      }
    }

    return {
      id,
      fromId,
      toId,
      directed,
      direction,
      color: color || '#3b82f6',
      path,
      style,
      lineType,
    };
  }

  private generateSelfLoopPath(
    pos: { x: number; y: number },
    gridSize: { width: number; height: number },
  ): { x: number; y: number }[] {
    const x = pos.x;
    const y = pos.y;
    const right = Math.min(gridSize.width - 1, x + 1);
    const down = Math.min(gridSize.height - 1, y + 1);
    const left = Math.max(0, x - 1);
    const up = Math.max(0, y - 1);

    // Prefer a 1-tile loop to the right/down, fallback to left/up near borders
    const x1 = right !== x ? right : left;
    const y1 = down !== y ? down : up;

    return [
      { x, y },
      { x: x1, y },
      { x: x1, y: y1 },
      { x, y: y1 },
      { x, y },
    ];
  }

  /**
   * Find if there's a connection passing through a given tile
   */
  getConnectionAt(
    x: number,
    y: number,
    connections: Conection[],
    nodes: Node[],
  ): Conection | undefined {
    return connections.find((conn) => {
      const path = conn.path || this.calculateDefaultPath(conn, nodes);
      return path?.some((p) => Math.round(p.x) === x && Math.round(p.y) === y);
    });
  }

  private densifyPath(points: { x: number; y: number }[]): { x: number; y: number }[] {
    if (points.length < 2) return points;
    const out: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];

    for (let i = 1; i < points.length; i++) {
      const prev = out[out.length - 1];
      const next = points[i];
      let cx = prev.x;
      let cy = prev.y;

      // Move diagonally first as much as possible, then straight
      while (cx !== next.x || cy !== next.y) {
        const dx = Math.sign(next.x - cx);
        const dy = Math.sign(next.y - cy);
        cx += dx;
        cy += dy;
        out.push({ x: cx, y: cy });
      }
    }
    return out;
  }

  pathCollidesWithNodes(
    path: { x: number; y: number }[],
    nodes: Node[],
    fromId: string,
    toId: string,
  ): boolean {
    if (path.length < 3) return false;
    const nodeByTile = new Map<string, string>();
    for (const n of nodes) {
      if (!n.active) continue;
      nodeByTile.set(`${n.position.x},${n.position.y}`, n.id);
    }

    // Only check middle points to allow starting/ending at node center
    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i];
      const idAtTile = nodeByTile.get(`${Math.round(p.x)},${Math.round(p.y)}`);
      if (idAtTile && idAtTile !== fromId && idAtTile !== toId) return true;
    }
    return false;
  }

  private routeThroughWaypoints(
    waypoints: { x: number; y: number }[],
    nodes: Node[],
    gridSize: { width: number; height: number },
    fromId: string,
    toId: string,
  ): { x: number; y: number }[] | null {
    if (waypoints.length < 2) return null;

    let result: { x: number; y: number }[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const start = waypoints[i];
      const end = waypoints[i + 1];
      // Use A* between segments with diagonal capability
      const seg = this.findPathBetweenPositions(start, end, nodes, gridSize, fromId, toId, true);
      if (!seg || seg.length === 0) return null;

      if (i === 0) result = seg;
      else result = [...result, ...seg.slice(1)];
    }

    return result;
  }

  private findPath(
    from: Node,
    to: Node,
    nodes: Node[],
    gridSize: { width: number; height: number },
    allowDiagonals: boolean = true,
  ): { x: number; y: number }[] | null {
    const start = from.position;
    const end = to.position;
    return this.findPathBetweenPositions(
      start,
      end,
      nodes,
      gridSize,
      from.id,
      to.id,
      allowDiagonals,
    );
  }

  private findPathBetweenPositions(
    start: { x: number; y: number },
    end: { x: number; y: number },
    nodes: Node[],
    gridSize: { width: number; height: number },
    fromId: string,
    toId: string,
    allowDiagonals: boolean = true,
  ): { x: number; y: number }[] | null {
    const openSet: { x: number; y: number; g: number; f: number; parent: any }[] = [];
    const closedSet = new Set<string>();

    openSet.push({ ...start, g: 0, f: this.heuristic(start, end), parent: null });

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;
      if (
        Math.round(current.x) === Math.round(end.x) &&
        Math.round(current.y) === Math.round(end.y)
      ) {
        const path = [];
        let temp: any = current;
        while (temp) {
          path.push({ x: temp.x, y: temp.y });
          temp = temp.parent;
        }
        return path.reverse();
      }

      closedSet.add(`${Math.round(current.x)},${Math.round(current.y)}`);

      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ];

      if (allowDiagonals) {
        neighbors.push(
          { x: current.x + 1, y: current.y + 1 },
          { x: current.x - 1, y: current.y - 1 },
          { x: current.x + 1, y: current.y - 1 },
          { x: current.x - 1, y: current.y + 1 },
        );
      }

      for (const neighbor of neighbors) {
        const nx = Math.round(neighbor.x);
        const ny = Math.round(neighbor.y);

        if (closedSet.has(`${nx},${ny}`)) continue;

        if (nx < 0 || nx >= gridSize.width || ny < 0 || ny >= gridSize.height) continue;

        const isObstacle = nodes.some(
          (n) =>
            n.active &&
            Math.round(n.position.x) === nx &&
            Math.round(n.position.y) === ny &&
            n.id !== fromId &&
            n.id !== toId,
        );
        if (isObstacle) continue;

        // Diagonal cost is sqrt(2) approx 1.4, straight is 1
        const isDiagonal = neighbor.x !== current.x && neighbor.y !== current.y;
        const moveCost = isDiagonal ? 1.414 : 1;
        const gScore = current.g + moveCost;

        let existing = openSet.find((o) => Math.round(o.x) === nx && Math.round(o.y) === ny);

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
    // Octile distance for diagonal movement
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const F = 1.414 - 1;
    return dx < dy ? F * dx + dy : F * dy + dx;
  }

  updateConnection(id: string, updates: Partial<Conection>, connections: Conection[]): Conection[] {
    return connections.map((c) => (c.id === id ? { ...c, ...updates } : c));
  }

  removeConnection(id: string, connections: Conection[]): Conection[] {
    return connections.filter((c) => c.id !== id);
  }
}
