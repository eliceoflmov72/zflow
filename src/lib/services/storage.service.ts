import { Injectable } from '@angular/core';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';

@Injectable()
export class StorageService {
  private readonly NODES_KEY = 'zflow_nodes';
  private readonly CONNECTIONS_KEY = 'zflow_connections';

  loadNodes(): FossFlowNode[] | null {
    const savedNodes = localStorage.getItem(this.NODES_KEY);
    if (!savedNodes) return null;

    try {
      return JSON.parse(savedNodes);
    } catch (e) {
      console.error('Failed to parse saved nodes', e);
      return null;
    }
  }

  loadConnections(): FossFlowConnection[] | null {
    const savedConns = localStorage.getItem(this.CONNECTIONS_KEY);
    if (!savedConns) return null;

    try {
      return JSON.parse(savedConns);
    } catch (e) {
      console.error('Failed to parse saved connections', e);
      return null;
    }
  }

  saveNodes(nodes: FossFlowNode[]): void {
    localStorage.setItem(this.NODES_KEY, JSON.stringify(nodes));
  }

  saveConnections(connections: FossFlowConnection[]): void {
    localStorage.setItem(this.CONNECTIONS_KEY, JSON.stringify(connections));
  }

  saveState(nodes: FossFlowNode[], connections: FossFlowConnection[]): void {
    this.saveNodes(nodes);
    this.saveConnections(connections);
  }

  clearStorage(): void {
    localStorage.removeItem(this.NODES_KEY);
    localStorage.removeItem(this.CONNECTIONS_KEY);
  }
}
