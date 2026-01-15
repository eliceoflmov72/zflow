# ZFlow Diagram Editor (antes FossFlow)

Advanced 3D Isometric Diagram Editor built with **Angular 21** and **Pure WebGPU**.

## Features

- **100% Native WebGPU**: No dependencies like Three.js or Babylon.js.
- **High Performance**: Geometry instancing for thousands of nodes.
- **Isometric Perspective**: Realistic 3D view with camera controls.
- **Interactive**: Node selection via raycasting and real-time editing.
- **Standalone**: Lightweight Angular components.

## Usage

1. Install the library (once published or via local link):

```bash
npm install @zemios/zflow
```

2. Import the component in your standalone component:

```typescript
import { ZflowEditorComponent } from '@zemios/zflow';

@Component({
  imports: [ZflowEditorComponent],
  template: ` <fossflow-editor></fossflow-editor> `,
})
export class MyComponent {}
```

## Development

To run the demo:

```bash
ng serve fossflow-demo
```
