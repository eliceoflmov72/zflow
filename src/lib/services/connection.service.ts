import { Injectable } from '@angular/core';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';

@Injectable()
export class ConnectionService {
  constructor() {}

  private debugEnabled = false;

  setDebugEnabled(enabled: boolean) {
    this.debugEnabled = enabled;
  }

  private debugLog(message: string, data?: unknown) {
    if (!this.debugEnabled) return;
    if (data !== undefined) console.debug(`[zflow][connection] ${message}`, data);
    else console.debug(`[zflow][connection] ${message}`);
  }

  /**
   * Check if a tile is occupied by a connection path
   */
  isTileOccupiedByConnection(
    x: number,
    y: number,
    connections: FossFlowConnection[],
    nodes: FossFlowNode[],
  ): boolean {
    return connections.some((conn) => {
      const path = conn.path || this.calculateDefaultPath(conn, nodes);
      return path?.some((p) => Math.round(p.x) === x && Math.round(p.y) === y);
    });
  }

  private calculateDefaultPath(
    conn: FossFlowConnection,
    nodes: FossFlowNode[],
  ): { x: number; y: number }[] {
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
    nodes: FossFlowNode[],
    gridSize: { width: number; height: number },
    directed = false,
    customPath?: { x: number; y: number }[],
    style: 'straight' | 'rounded' = 'straight',
    lineType: 'solid' | 'dashed' = 'solid',
    color?: string,
    direction?: 'forward' | 'reverse' | 'bi',
  ): FossFlowConnection {
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

    const id = `manual-${Math.random().toString(36).substr(2, 9)}`;
    const fromNode = nodes.find((n) => n.id === fromId);
    const toNode = nodes.find((n) => n.id === toId);

    if (fromId === toId && fromNode) {
      const loop = this.generateSelfLoopPath(fromNode.position, gridSize);
      return {
        id,
        fromId,
        toId,
        directed,
        direction,
        color: color || '#3b82f6',
        path: loop,
        style,
        lineType,
      };
    }

    let path = customPath ? customPath.map((p) => ({ ...p })) : undefined;
    if (fromNode && toNode) {
      if (!path) {
        path = this.findPath(fromNode, toNode, nodes, gridSize) || undefined;
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

  private densifyPath(points: { x: number; y: number }[]): { x: number; y: number }[] {
    if (points.length < 2) return points;
    const out: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i < points.length; i++) {
      const prev = out[out.length - 1];
      const next = points[i];
      let cx = prev.x;
      let cy = prev.y;
      while (cx !== next.x) {
        cx += Math.sign(next.x - cx);
        out.push({ x: cx, y: cy });
      }
      while (cy !== next.y) {
        cy += Math.sign(next.y - cy);
        out.push({ x: cx, y: cy });
      }
    }
    return out;
  }

  pathCollidesWithNodes(
    path: { x: number; y: number }[],
    nodes: FossFlowNode[],
    fromId: string,
    toId: string,
  ): boolean {
    if (path.length < 3) return false;
    const nodeByTile = new Map<string, string>();
    for (const n of nodes) {
      if (!n.active) continue;
      nodeByTile.set(`${n.position.x},${n.position.y}`, n.id);
    }

    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i];
      const idAtTile = nodeByTile.get(`${p.x},${p.y}`);
      if (idAtTile && idAtTile !== fromId && idAtTile !== toId) return true;
    }
    return false;
  }

  private routeThroughWaypoints(
    waypoints: { x: number; y: number }[],
    nodes: FossFlowNode[],
    gridSize: { width: number; height: number },
    fromId: string,
    toId: string,
  ): { x: number; y: number }[] | null {
    if (waypoints.length < 2) return null;

    let result: { x: number; y: number }[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const start = waypoints[i];
      const end = waypoints[i + 1];
      const seg = this.findPathBetweenPositions(start, end, nodes, gridSize, fromId, toId);
      if (!seg || seg.length === 0) return null;

      // Stitch segments: avoid duplicating the joint point
      if (i === 0) result = seg;
      else result = [...result, ...seg.slice(1)];
    }

    if (this.pathCollidesWithNodes(result, nodes, fromId, toId)) {
      this.debugLog('routeThroughWaypoints: routed path still collides', { fromId, toId });
      return null;
    }

    return result;
  }

  /**
   * A* Implementation to avoid active nodes (obstacles)
   */
  private findPath(
    from: FossFlowNode,
    to: FossFlowNode,
    nodes: FossFlowNode[],
    gridSize: { width: number; height: number },
  ): { x: number; y: number }[] | null {
    const start = from.position;
    const end = to.position;
    return this.findPathBetweenPositions(start, end, nodes, gridSize, from.id, to.id);
  }

  private findPathBetweenPositions(
    start: { x: number; y: number },
    end: { x: number; y: number },
    nodes: FossFlowNode[],
    gridSize: { width: number; height: number },
    fromId: string,
    toId: string,
  ): { x: number; y: number }[] | null {
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
        const isObstacle = nodes.some(
          (n) =>
            n.active &&
            n.position.x === neighbor.x &&
            n.position.y === neighbor.y &&
            n.id !== fromId &&
            n.id !== toId,
        );
        if (isObstacle) continue;

        // Out of bounds
        if (
          neighbor.x < 0 ||
          neighbor.x >= gridSize.width ||
          neighbor.y < 0 ||
          neighbor.y >= gridSize.height
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

  /**
   * Update a connection (returns the updated connection)
   */
  updateConnection(
    id: string,
    updates: Partial<FossFlowConnection>,
    connections: FossFlowConnection[],
  ): FossFlowConnection[] {
    return connections.map((c) => (c.id === id ? { ...c, ...updates } : c));
  }

  /**
   * Remove a connection (returns the filtered connections)
   */
  removeConnection(id: string, connections: FossFlowConnection[]): FossFlowConnection[] {
    return connections.filter((c) => c.id !== id);
  }
}
