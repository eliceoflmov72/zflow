# ZFlow 3D Editor
<img width="1722" height="983" alt="image" src="https://github.com/user-attachments/assets/3d964632-08d7-4036-83f0-ce952d5805ee" />


Advanced 3D Isometric Diagram and Grid Editor built with **Angular 21** and **Pure WebGPU**.

ZFlow is a high-performance, standalone library designed for creating interactive 3D diagrams, floor plans, and isometric visualizations directly in the browser using modern GPU acceleration.

## 🚀 Features

- **100% Native WebGPU**: No heavy dependencies like Three.js or Babylon.js. Uses custom shaders for maximum performance.
- **High Performance**: Geometry instancing allows rendering thousands of elements even on low-end hardware.
- **Isometric Perspective**: Realistic 3D view with intuitive camera controls (Pan, Rotate, Zoom).
- **Interactive Editor**: Built-in tools for painting, connecting, and selecting objects.
- **Adaptive Quality**: Automatically adjusts rendering settings to maintain a smooth framerate.
- **Fully Decoupled**: Zero external UI dependencies. All components and modales are self-contained.

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

- **`nodes`** (`Node[]`): Colección inicial de objetos y estados de la cuadrícula.
- **`gridSize`** (`{ width: number; height: number }`): Dimensiones del área de trabajo (por defecto 40x40).

### Output Events

- **`nodesChange`** (`Node[]`): Se dispara cuando un objeto es creado, movido, pintado o eliminado.

---

## 🧩 Data Models

### Node

Represents an object or a tile state in the grid.

```typescript
interface Node {
  id: string;
  position: { x: number; y: number; z?: number };
  title: string;
  description: string;
  shape3D: string; // Filename in /forms/ or /images/
  color: string;
  floorColor: string;
  active: boolean;
  height?: number;
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

ZFlow is designed to be completely autonomous:

- **No Workspace Dependencies**: Uses its own isolated config.
- **Internal UI**: Includes its own buttons, toolbars, and modals (optimized for the 3D canvas).
- **Service Driven**: Logic is decoupled into `GridService`, `ConnectionService`, and `WebGPUEngine`.

## 📜 License

[Zemios Nebula License]
