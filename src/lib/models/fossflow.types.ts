export type FossFlowShape = string;

export interface FossFlowPosition {
  x: number;
  y: number;
  z?: number;
}

export interface FossFlowConnection {
  id: string;
  fromId: string;
  toId: string;
  directed: boolean;
  direction?: 'forward' | 'reverse' | 'bi';
  style?: 'straight' | 'rounded';
  lineType?: 'solid' | 'dashed';
  color?: string;
  weight?: number;
  path?: { x: number; y: number }[];
}

export interface FossFlowNode {
  id: string;
  position: FossFlowPosition;
  title: string;
  description: string;
  shape3D: FossFlowShape;
  color: string;
  floorColor: string;
  active: boolean;
  height?: number;
  maxConnections?: number;
  connectionPriority?: number;
  connectionTags?: string[];
}

export interface FossFlowState {
  nodes: FossFlowNode[];
  connections: FossFlowConnection[];
  gridSize: { width: number; height: number };
}

export type ZFlowShape = FossFlowShape;
export type ZFlowPosition = FossFlowPosition;
export type ZFlowConnection = FossFlowConnection;
export type ZFlowNode = FossFlowNode;
export type ZFlowState = FossFlowState;
