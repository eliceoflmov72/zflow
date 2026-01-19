import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';

@Injectable()
export class StorageService {
  private platformId = inject(PLATFORM_ID);
  private readonly NODES_KEY = 'zflow_nodes';
  private readonly CONNECTIONS_KEY = 'zflow_connections';
  private readonly CONNECTION_CONFIG_KEY = 'zflow_connection_config';

  loadNodes(): FossFlowNode[] | null {
    if (!isPlatformBrowser(this.platformId)) return null;
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
    if (!isPlatformBrowser(this.platformId)) return null;
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
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(this.NODES_KEY, JSON.stringify(nodes));
  }

  saveConnections(connections: FossFlowConnection[]): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(this.CONNECTIONS_KEY, JSON.stringify(connections));
  }

  saveState(nodes: FossFlowNode[], connections: FossFlowConnection[]): void {
    this.saveNodes(nodes);
    this.saveConnections(connections);
  }

  loadConnectionConfig(): {
    activeStyle: 'straight' | 'rounded';
    presets: {
      straight: {
        lineType: 'solid' | 'dashed';
        directed: boolean;
        direction: 'forward' | 'reverse' | 'bi';
        color: string;
      };
      rounded: {
        lineType: 'solid' | 'dashed';
        directed: boolean;
        direction: 'forward' | 'reverse' | 'bi';
        color: string;
      };
    };
  } | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const saved = localStorage.getItem(this.CONNECTION_CONFIG_KEY);
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.style && parsed.lineType) {
        const style = parsed.style as 'straight' | 'rounded';
        const preset = {
          lineType: parsed.lineType as 'solid' | 'dashed',
          directed: !!parsed.directed,
          direction: (parsed.direction || 'forward') as 'forward' | 'reverse' | 'bi',
          color: (parsed.color || '#3b82f6') as string,
        };
        return {
          activeStyle: style,
          presets: {
            straight: { ...preset },
            rounded: { ...preset },
          },
        };
      }

      return parsed;
    } catch (e) {
      console.error('Failed to parse saved connection config', e);
      return null;
    }
  }

  saveConnectionConfig(config: {
    activeStyle: 'straight' | 'rounded';
    presets: {
      straight: {
        lineType: 'solid' | 'dashed';
        directed: boolean;
        direction: 'forward' | 'reverse' | 'bi';
        color: string;
      };
      rounded: {
        lineType: 'solid' | 'dashed';
        directed: boolean;
        direction: 'forward' | 'reverse' | 'bi';
        color: string;
      };
    };
  }): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(this.CONNECTION_CONFIG_KEY, JSON.stringify(config));
  }

  clearStorage(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(this.NODES_KEY);
    localStorage.removeItem(this.CONNECTIONS_KEY);
    localStorage.removeItem(this.CONNECTION_CONFIG_KEY);
  }
}
