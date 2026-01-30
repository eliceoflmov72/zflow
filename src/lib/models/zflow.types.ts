export type Shape = string;

export interface Position {
  x: number;
  y: number;
  z?: number;
}

export interface Conection {
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

export interface Node {
  id: string;
  position: Position;
  title: string;
  description: string;
  shape3D: Shape;
  color: string;
  floorColor: string;
  active: boolean;
  height?: number;
  maxConnections?: number;
  connectionPriority?: number;
  connectionTags?: string[];
}

export interface State {
  nodes: Node[];
  connections: Conection[];
  gridSize: { width: number; height: number };
}

export type ZFlowShape = Shape;
export type ZFlowPosition = Position;
export type ZFlowConnection = Conection;
export type ZFlowNode = Node;
export type ZFlowState = State;
