# ZFlow Diagram Editor

Advanced 3D Isometric Diagram Editor built with **Angular 21** and **Pure WebGPU**.

## Features

- **100% Native WebGPU**: No dependencies like Three.js or Babylon.js.
- **High Performance**: Geometry instancing for thousands of nodes.
- **Isometric Perspective**: Realistic 3D view with camera controls.
- **Interactive**: Node selection via raycasting and real-time editing.
- **Standalone**: Lightweight Angular components with zero external dependencies (except Angular core).
- **Fully Decoupled**: Can be used independently in any Angular application.

## Installation

```bash
npm install zflow
```

## Peer Dependencies

ZFlow requires the following peer dependencies:

- `@angular/common`: ^21.0.0
- `@angular/core`: ^21.0.0

## Setup

### 1. Import the Component

Import `ZFlowEditor` in your standalone component:

```typescript
import { ZFlowEditor } from 'zflow';

@Component({
  selector: 'app-diagram',
  standalone: true,
  imports: [ZFlowEditor],
  template: `<zflow-editor></zflow-editor>`,
})
export class DiagramComponent {}
```

### 2. Copy Assets

ZFlow requires static assets (SVG icons, forms, and images) to be available in your application's public directory. After installing zflow, copy the assets to your application's public folder:

**For Angular applications:**

1. Locate the `public` folder in the zflow package (typically in `node_modules/zflow/public`)
2. Copy the contents to your application's `public` or `assets` folder:

```bash
# Example: Copy assets to your Angular app's public folder
cp -r node_modules/zflow/public/* src/public/
```

Or configure your `angular.json` to include the assets:

```json
{
  "projects": {
    "your-app": {
      "architect": {
        "build": {
          "options": {
            "assets": [
              {
                "glob": "**/*",
                "input": "node_modules/zflow/public",
                "output": "/"
              }
            ]
          }
        }
      }
    }
  }
}
```

**Required asset paths:**

- `/forms/` - SVG form shapes (isometric-cube.svg, isometric-sphere.svg, etc.)
- `/images/` - PNG images (car.png, code.png, database.png, etc.)
- `/icons/` - SVG icons (cursor-select.svg, hand-pan.svg, etc.)

### 3. WebGPU Support

ZFlow requires WebGPU support. Ensure your application runs in a browser that supports WebGPU (Chrome 113+, Edge 113+, or other Chromium-based browsers).

## Usage Example

```typescript
import { Component } from '@angular/core';
import { ZFlowEditor } from 'zflow';
import { Node, Conection } from 'zflow';

@Component({
  selector: 'app-diagram-editor',
  standalone: true,
  imports: [ZFlowEditor],
  template: `
    <zflow-editor
      [nodes]="initialNodes"
      [connections]="initialConnections"
      (nodesChange)="onNodesChange($event)"
      (connectionsChange)="onConnectionsChange($event)"
    ></zflow-editor>
  `,
})
export class DiagramEditorComponent {
  initialNodes: Node[] = [
    {
      id: '1',
      x: 0,
      y: 0,
      z: 0,
      color: '#3b82f6',
      shape3D: 'isometric-cube.svg',
    },
  ];

  initialConnections: Conection[] = [];

  onNodesChange(nodes: Node[]): void {
    console.log('Nodes updated:', nodes);
  }

  onConnectionsChange(connections: Conection[]): void {
    console.log('Connections updated:', connections);
  }
}
```

## API

### ZFlowEditor Component

**Inputs:**

- `nodes: Node[]` - Initial nodes to display
- `connections: Conection[]` - Initial connections between nodes

**Outputs:**

- `nodesChange: EventEmitter<Node[]>` - Emitted when nodes are modified
- `connectionsChange: EventEmitter<Conection[]>` - Emitted when connections are modified

### Types

```typescript
interface Node {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  shape3D?: string;
  lod?: 'low' | 'high';
}

interface Conection {
  id: string;
  sourceId: string;
  targetId: string;
  style?: 'straight' | 'rounded';
  lineType?: 'solid' | 'dashed';
}
```

## Development

To build the library:

```bash
npm run build
```

To watch for changes:

```bash
npm run watch
```

## Architecture

ZFlow is designed to be completely independent:

- **No workspace dependencies**: Uses its own TypeScript configuration
- **No shared components**: All UI components are self-contained
- **Standalone components**: All components are standalone Angular components
- **Pure WebGPU**: No external 3D libraries required
- **Zero runtime dependencies**: Only requires Angular core packages

## Browser Support

- Chrome 113+
- Edge 113+
- Other Chromium-based browsers with WebGPU support

## License

[Your License Here]
