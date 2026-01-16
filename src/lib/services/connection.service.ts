import { Injectable } from '@angular/core';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';

@Injectable()
export class ConnectionService {
  constructor() {}

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
  ): FossFlowConnection {
    const id = `manual-${Math.random().toString(36).substr(2, 9)}`;
    const fromNode = nodes.find((n) => n.id === fromId);
    const toNode = nodes.find((n) => n.id === toId);

    let path = customPath;
    if (!path && fromNode && toNode) {
      path = this.findPath(fromNode, toNode, nodes, gridSize) || undefined;
    }

    return { id, fromId, toId, directed, color: '#3b82f6', path, style, lineType };
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
            n.id !== from.id &&
            n.id !== to.id,
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
