# ZFlow 3D Editor
<img width="1573" height="977" alt="isometric-diagram-editor" src="https://github.com/user-attachments/assets/a521f99c-52ed-44b4-9180-d7925283a81e" />
<img width="1563" height="973" alt="isometric-diagram-editor-1" src="https://github.com/user-attachments/assets/7825fb4e-0f52-4771-b772-6c4daad350e8" />



Advanced 3D Isometric Diagram and Grid Editor built with **Angular 21** and **Pure WebGPU**.

ZFlow is a high-performance, standalone library designed for creating interactive 3D diagrams, floor plans, and isometric visualizations directly in the browser using modern GPU acceleration.

## 🚀 Features

- **100% Native WebGPU**: No heavy dependencies like Three.js or Babylon.js. Uses custom shaders for maximum performance.
- **High Performance**: Geometry instancing allows rendering thousands of elements even on low-end hardware.
- **Isometric Perspective**: Realistic 3D view with intuitive camera controls (Pan, Rotate, Zoom).
- **Interactive Editor**: Built-in tools for painting, connecting, and selecting objects.
- **Adaptive Quality**: Automatically adjusts rendering settings to maintain a smooth framerate.
- **Fully Decoupled**: Zero external UI dependencies. All components and modals are self-contained.

## 📦 Installation

```bash
npm install zflow
```

## 🛠️ Setup

### 1. Import the Component

Import `ZFlowEditor` (and optionally the types) in your standalone component:

```typescript
import { Component } from '@angular/core';
import { ZFlowEditor, Node, Conection } from 'zflow';

@Component({
  selector: 'app-my-editor',
  standalone: true,
  imports: [ZFlowEditor],
  template: `
    <div style="height: 600px; width: 100%;">
      <zflow-editor
        [nodes]="initialNodes"
        [gridSize]="{ width: 40, height: 40 }"
        (nodesChange)="onNodesUpdate($event)"
      ></zflow-editor>
    </div>
  `,
})
export class MyEditorComponent {
  initialNodes: Node[] = [];

  onNodesUpdate(nodes: Node[]) {
    console.log('State updated:', nodes);
  }
}
```

### 2. Assets Configuration

ZFlow requires static assets (SVG forms, icons, and textures) to be served from specific paths. You need to copy the `public` folder from the package to your application's public directory.

**Recommended `angular.json` config:**

```json
{
  "assets": [
    {
      "glob": "**/*",
      "input": "node_modules/zflow/public",
      "output": "/"
    }
  ]
}
```

**Required paths:**

- `/forms/` (SVG shapes)
- `/images/` (Textures/Sprites)
- `/icons/` (UI Icons)

### 3. WebGPU Compatibility

Your application must run in a browser with **WebGPU** enabled (Chrome 113+, Edge 113+, etc.). The component includes an automatic fallback or error message for unsupported browsers.

---

## 📖 API Reference

### Input Properties

- **`nodes`** (`Node[]`): Initial collection of objects and grid states.
- **`gridSize`** (`{ width: number; height: number }`): Dimensions of the workspace (default 40x40).

### Output Events

- **`nodesChange`** (`Node[]`): Triggered when an object is created, moved, painted, or deleted.

---

## 🧩 Data Models

### Node

Represents an object or a tile state in the grid.

```typescript
interface Node {
  id: string;
  position: { x: number; y: number; z?: number };
  title: string;
  showLabel?: boolean;
  description: string;
  shape3D: string; // Filename in /forms/ or /images/
  color: string;
  floorColor: string;
  active: boolean;
  height?: number;
  maxConnections?: number;
  connectionPriority?: number;
  connectionTags?: string[];
}
```

### Conection

Represents a logical relationship between points or nodes.

```typescript
interface Conection {
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
```

---

## 🏛️ Architecture

ZFlow is designed to be completely autonomous and framework-agnostic within the Angular ecosystem:

- **No Workspace Dependencies**: Uses its own isolated configuration and state management.
- **Internal UI**: Includes its own buttons, toolbars, and modals (optimized for the 3D canvas overlay).
- **Service Driven**: Logic is decoupled into core services:
  - `GridService`: Manages the spatial state, nodes, and quadtree partitioning.
  - `ConnectionService`: Handles routing and relationships between nodes.
  - `WebGPUEngine`: Handles the low-level rendering loop, shader compilation, and instanced mesh generation.

## 📜 License (MIT)

**Copyright (c) 2026 ZFlow Project**

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

**The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.**

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
