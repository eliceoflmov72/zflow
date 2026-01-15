import {
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
  computed,
  effect,
  OnDestroy,
  HostListener,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GridService } from '../services/grid.service';
import { WebGPUEngine } from '../webgpu/engine';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';
import { ModalComponent } from 'seshat-components';
import { BottomToolbar } from './toolbar/bottom-toolbar/bottom-toolbar';
import { TopToolbar } from './toolbar/top-toolbar/top-toolbar';
import { SelectionSidebar } from './sidebar/selection-sidebar/selection-sidebar';
import { NodeSidebar } from './sidebar/node-sidebar/node-sidebar';
import { PaintSidebar } from './sidebar/paint-sidebar/paint-sidebar';
import { ConnectionSidebar } from './sidebar/connection-sidebar/connection-sidebar';
import { PerformanceMonitorComponent } from './performance-monitor/performance-monitor';

@Component({
  selector: 'fossflow-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    BottomToolbar,
    TopToolbar,
    SelectionSidebar,
    NodeSidebar,
    PaintSidebar,
    ConnectionSidebar,
    PerformanceMonitorComponent,
  ],
  providers: [GridService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ff-container light-mode"
      [class.mode-pan]="editorMode() === 'pan'"
      (contextmenu)="$event.preventDefault()"
    >
      <canvas
        #gpuCanvas
        (mousedown)="onMouseDown($event)"
        (wheel)="onWheel($event)"
        (click)="onClick($event)"
      ></canvas>

      <!-- Connections Layer -->
      <svg class="ff-connections-overlay">
        <defs></defs>
        <!-- Active drawing path (Moved outside loop) -->
        @if (activePath().length > 0) {
          <path
            [attr.d]="activePathData()"
            fill="none"
            stroke="#3b82f6"
            stroke-width="5"
            [attr.stroke-dasharray]="currentLineType() === 'dashed' ? '5,5' : ''"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="pointer-events: none;"
          />
        }

        @for (conn of positionedConnections(); track conn.id) {
          <!-- Hidden wider hit area -->
          <path
            [attr.d]="conn.pathData || 'M ' + conn.points.split(' ').join(' L ')"
            fill="none"
            stroke="transparent"
            [attr.stroke-width]="25 * conn.scale"
            style="cursor: pointer; pointer-events: stroke;"
            (click)="onConnectionClick($event, conn.id)"
          />
          <!-- Visible Line -->
          <path
            [attr.d]="conn.pathData || 'M ' + conn.points.split(' ').join(' L ')"
            [style.color]="conn.color"
            stroke="currentColor"
            fill="none"
            [attr.stroke-width]="
              (gridService.selectedConnectionId() === conn.id ? 8 : 5) * conn.scale
            "
            [attr.stroke-dasharray]="
              conn.lineType === 'dashed' ? 12 * conn.scale + ',' + 10 * conn.scale : ''
            "
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ff-connection-line"
            [class.ff-conn-selected]="gridService.selectedConnectionId() === conn.id"
            style="pointer-events: none;"
          />

          <!-- Drag Handles -->
          @if (gridService.selectedConnectionId() === conn.id && !isDraggingEndpoint) {
            <circle
              [attr.cx]="conn.firstPoint.x"
              [attr.cy]="conn.firstPoint.y"
              r="6"
              fill="white"
              stroke="#3b82f6"
              stroke-width="2"
              style="cursor: pointer; pointer-events: auto;"
              (mousedown)="onHandleMouseDown($event, conn.id, 'start')"
            />
            <circle
              [attr.cx]="conn.lastPoint.x"
              [attr.cy]="conn.lastPoint.y"
              r="6"
              fill="white"
              stroke="#3b82f6"
              stroke-width="2"
              style="cursor: pointer; pointer-events: auto;"
              (mousedown)="onHandleMouseDown($event, conn.id, 'end')"
            />
          }

          <!-- Dragging Feedback -->
          @if (isDraggingEndpoint && draggedConnectionId === conn.id) {
            <line
              [attr.x1]="draggedEndpointType === 'start' ? lastMousePos.x : conn.firstPoint.x"
              [attr.y1]="draggedEndpointType === 'start' ? lastMousePos.y : conn.firstPoint.y"
              [attr.x2]="draggedEndpointType === 'end' ? lastMousePos.x : conn.lastPoint.x"
              [attr.y2]="draggedEndpointType === 'end' ? lastMousePos.y : conn.lastPoint.y"
              stroke="#3b82f6"
              stroke-width="2"
              stroke-dasharray="5,5"
              style="pointer-events: none;"
            />
            <circle
              [attr.cx]="lastMousePos.x"
              [attr.cy]="lastMousePos.y"
              r="6"
              fill="#3b82f6"
              stroke="white"
              stroke-width="2"
              style="pointer-events: none;"
            />
          }

          @if (conn.directed && conn.arrowPoints) {
            <polygon
              [attr.points]="conn.arrowPoints"
              [style.fill]="conn.color"
              style="pointer-events: none;"
            />
          }
          @if (conn.directed && conn.arrowPointsStart) {
            <polygon
              [attr.points]="conn.arrowPointsStart"
              [style.fill]="conn.color"
              style="pointer-events: none;"
            />
          }
        }
      </svg>

      <!-- SVG/Image Overlays for objects -->
      <div class="ff-objects-overlay">
        @for (node of positionedNodes(); track node.id) {
          <div
            class="ff-object-container"
            [style.transform]="
              'translate3d(' + node.screenX + 'px, ' + node.screenY + 'px, 0) translate(-50%, -85%)'
            "
            [style.width.px]="100 * node.scale"
            [style.height.px]="100 * node.scale"
            [style.z-index]="node.zIndex"
            [class.ff-object-selected]="gridService.selectedNodeIds().includes(node.id)"
            [class.ff-object-source]="connectSourceId() === node.id"
            [class.is-node-hovered]="hoveredNodeId() === node.id"
            [class.ff-node-valid-target]="
              hoveredNodeId() === node.id &&
              editorMode() === 'connect' &&
              connectSourceId() !== node.id
            "
          >
            <div class="ff-node-content"></div>
            <div
              class="ff-object-mask"
              [style.background-color]="
                node.shape3D && node.shape3D.indexOf('.png') !== -1 ? 'transparent' : node.color
              "
              [style.background-image]="
                node.shape3D && node.shape3D.indexOf('.png') !== -1
                  ? 'url(/images/' + node.shape3D + ')'
                  : 'none'
              "
              [style.background-size]="'contain'"
              [style.background-repeat]="'no-repeat'"
              [style.background-position]="'center bottom'"
              [style.mask-image]="
                node.lod === 'low' || (node.shape3D && node.shape3D.indexOf('.png') !== -1)
                  ? 'none'
                  : 'url(/forms/' + (node.shape3D || 'isometric-cube.svg') + ')'
              "
              [style.-webkit-mask-image]="
                node.lod === 'low' || (node.shape3D && node.shape3D.indexOf('.png') !== -1)
                  ? 'none'
                  : 'url(/forms/' + (node.shape3D || 'isometric-cube.svg') + ')'
              "
              [style.border-radius]="node.lod === 'low' ? '4px' : '0'"
              [style.opacity]="node.lod === 'low' ? '0.7' : '1'"
            ></div>
          </div>
        }
      </div>

      <!-- Paint Preview Overlay -->
      @for (p of paintPreviewNodes(); track $index) {
        <div
          class="ff-node-plate preview-plate"
          [style.left.px]="p.x"
          [style.top.px]="p.y"
          [style.width.px]="15 * p.scale"
          [style.height.px]="15 * p.scale"
          [style.z-index]="p.zIndex"
        ></div>
      }

      @if (!webGpuSupported()) {
        <div class="ff-error">
          <p>WebGPU is not supported in your browser.</p>
        </div>
      }

      <div class="ff-ui-overlay">
        <!-- TOP TOOLBAR -->
        <top-toolbar
          [editorMode]="editorMode"
          [connectionStyle]="connectionStyle"
          [currentLineType]="currentLineType"
          [isFullscreen]="isFullscreen"
          [showClearConfirm]="showClearConfirm"
        />

        <!-- ZOOM MENU BOTTOM RIGHT -->
        <bottom-toolbar
          [currentRotationLabel]="currentRotationLabel"
          [zoomLabel]="zoomLabel"
          (rotateLeft)="rotateLeft()"
          (rotateRight)="rotateRight()"
          (zoomOut)="zoomOut()"
          (zoomIn)="zoomIn()"
          (resetView)="resetView()"
        />

        <!-- PERFORMANCE INDICATOR (Dev Mode) -->
        @if (showPerformanceStats()) {
          <performance-monitor
            [currentFps]="currentFps"
            [currentQualityLevel]="currentQualityLevel"
            [visibleNodesCount]="visibleNodesCount"
          />
        }

        <!-- SIDEBAR -->
        @if (gridService.selectedNodeIds().length > 1) {
          <!-- MULTI SELECTION SIDEBAR -->
          <selection-sidebar
            [availableSvgs]="availableSvgs"
            [recentColors]="recentColors"
            (updateSelectedNodes)="updateSelectedNodes($event)"
            (deleteSelected)="deleteSelected()"
          />
        } @else if (selectedNode(); as node) {
          <node-sidebar
            [node]="node"
            [availableSvgs]="availableSvgs"
            [recentColors]="recentColors"
            (removeObject)="removeObject($event)"
            (selectObject)="selectObject($event.svg, $event.node)"
            (onObjectColorInput)="onObjectColorInput($event.event, $event.node)"
            (onFloorColorInput)="onFloorColorInput($event.event, $event.node)"
            (applyRecentColorToObject)="applyRecentColorToObject($event.color, $event.node)"
            (applyRecentColorToFloor)="applyRecentColorToFloor($event.color, $event.node)"
            (deleteSelected)="deleteSelected()"
          />
        } @else if (
          !selectedNode() &&
          !selectedConnection() &&
          (editorMode() === 'paint' || editorMode() === 'paint-floor')
        ) {
          <!-- BRUSH SIDEBAR -->
          <paint-sidebar
            [paintTool]="paintTool"
            [paintObjectEnabled]="paintObjectEnabled"
            [paintFloorEnabled]="paintFloorEnabled"
            [brushShape]="brushShape"
            [brushObjectColor]="brushObjectColor"
            [brushFloorColor]="brushFloorColor"
            [availableSvgs]="availableSvgs"
            [recentColors]="recentColors"
          />
        }

        <!-- CONNECTION SIDEBAR -->
        @if (selectedConnection(); as conn) {
          <connection-sidebar
            [conn]="conn"
            [getAllowedDirection]="getAllowedDirection"
            (updateConnection)="updateConnection($event.id, $event.updates)"
            (onConnectionColorInput)="onConnectionColorInput($event.event, $event.id)"
          />
        }

        <!-- CLEAR CONFIRM MODAL -->
        <modal
          [isOpen]="showClearConfirm()"
          title="¿Limpiar Diagrama?"
          description="Esta acción eliminará todos los objetos y conexiones de forma permanente. ¿Deseas continuar?"
          confirmButtonText="Sí, Limpiar Todo"
          cancelButtonText="Cancelar"
          confirmButtonType="danger"
          (confirmAction)="confirmClear()"
          (closeAction)="showClearConfirm.set(false)"
        />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
        font-family: 'Inter', system-ui, sans-serif;
      }
      .ff-container.light-mode {
        width: 100%;
        height: 100%;
        position: relative;
        background: #e5eaf1; /* Specific Light Blue-Gray requested */
      }
      canvas {
        width: 100%;
        height: 100%;
        display: block;
        cursor: default;
      }
      .mode-pan canvas {
        cursor: grab;
      }
      .mode-pan canvas:active {
        cursor: grabbing;
      }
      .ff-connections-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 5;
      }
      .ff-connection-line {
        opacity: 0.8;
        pointer-events: none;
      }
      .ff-conn-selected {
        opacity: 1;
        filter: drop-shadow(0 0 5px currentColor);
      }
      .ff-btn-delete {
        width: 100%;
        background: #fef2f2;
        color: #ef4444;
        border: 1px solid #fee2e2;
        padding: 0.75rem;
        border-radius: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.2s;
        margin-top: 1rem;
      }
      .ff-btn-delete:hover {
        background: #fee2e2;
        transform: translateY(-1px);
      }
      .ff-switch-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        cursor: pointer;
      }
      .ff-objects-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10;
      }
      .ff-ui-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 100;
      }
      .ff-object-container {
        position: absolute;
        transform: translate(-50%, -85%);
        will-change: transform;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        filter: drop-shadow(0 15px 40px rgba(0, 0, 0, 0.25));
      }
      .ff-object-selected {
        filter: drop-shadow(0 0 20px rgba(59, 130, 246, 0.8))
          drop-shadow(0 15px 40px rgba(0, 0, 0, 0.25)) !important;
        transform: translate(-50%, -105%) scale(1.1);
        z-index: 1001 !important;
      }
      .ff-object-source {
        filter: drop-shadow(0 0 20px rgba(255, 255, 255, 1))
          drop-shadow(0 15px 40px rgba(0, 0, 0, 0.4)) !important;
        transform: translate(-50%, -100%) scale(1.1);
        z-index: 1001 !important;
      }
      .ff-node-hover {
        filter: drop-shadow(0 0 10px rgba(59, 130, 246, 0.6)) !important;
        transform: translate(-50%, -95%);
      }
      .ff-node-valid-target {
        filter: drop-shadow(0 0 15px rgba(34, 197, 94, 0.8)) !important; /* Green glow */
        cursor: crosshair;
        transform: translate(-50%, -100%) scale(1.05);
      }
      .ff-object-mask {
        width: 100%;
        height: 100%;
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: bottom center;
        -webkit-mask-size: contain;
        -webkit-mask-repeat: no-repeat;
        -webkit-mask-position: bottom center;
        transition: background-color 0.1s ease;
      }
      .ff-object-gallery {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      .ff-gallery-item {
        aspect-ratio: 1;
        background: #f8fafc;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        padding: 0.5rem;
        color: #64748b;
      }
      .ff-gallery-item:hover {
        border-color: #3b82f6;
        background: #eff6ff;
        transform: translateY(-2px);
      }
      .ff-gallery-item.active {
        border-color: #3b82f6;
        background: #eff6ff;
        color: #3b82f6;
      }
      /* Removed .ff-toolbar styles (moved to toolbar.css) */
      /* Removed .ff-zoom-menu styles (moved to zoom-menu.css) */
      .ff-mode-toggle {
        display: flex;
        gap: 0.3rem;
      }
      .ff-divider {
        width: 1px;
        height: 1.5rem;
        background: rgba(0, 0, 0, 0.1);
      }
      .ff-grid-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #64748b;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .ff-toolbar button {
        background: transparent;
        border: none;
        color: #475569;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        width: 40px;
        height: 40px;
        padding: 0;
      }
      .ff-toolbar button.active {
        background: transparent !important;
        color: #3b82f6 !important;
        box-shadow: none !important;
      }

      .ff-btn-delete:hover {
        background: #fee2e2;
        border-color: #fca5a5;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.1);
      }
      .ff-btn-delete i {
        font-size: 1rem;
      }
      .ff-debug-hint {
        position: absolute;
        bottom: 1rem;
        left: 1rem;
        color: #94a3b8;
        font-size: 0.75rem;
      }
      .ff-object-gallery {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      .ff-gallery-item {
        aspect-ratio: 1;
        background: #f8fafc;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border: 2px solid transparent;
        transition: all 0.2s ease;
        padding: 8px;
        color: #64748b;
      }
      .ff-gallery-item:hover {
        background: #f1f5f9;
        transform: translateY(-2px);
        color: #1e293b;
      }
      .ff-gallery-preview {
        width: 100%;
        height: 100%;
        background-color: currentColor;
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        -webkit-mask-size: contain;
        -webkit-mask-repeat: no-repeat;
        -webkit-mask-position: center;
      }
      .ff-btn-clear {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ff-btn-clear:hover {
        background: #fef2f2;
        color: #ef4444;
      }
      .ff-btn-clear:hover {
        background: #fef2f2;
        color: #ef4444;
      }
      .ff-node-plate {
        position: absolute;
        transform: translate(-50%, -85%);
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(59, 130, 246, 0.2); /* Light blue for preview */
        border: 1px dashed #3b82f6;
        border-radius: 4px;
      }
      .preview-plate {
        background-color: rgba(59, 130, 246, 0.2);
        border: 1px dashed #3b82f6;
      }
      .selection-plate {
        background-color: rgba(250, 204, 21, 0.2); /* Yellow for selection */
        border: 1px solid #eab308;
      }
      /* ==================== PERFORMANCE STATS ==================== */
      /* Moved performance monitor styles */
    `,
  ],
})
export class FossflowEditorComponent implements OnInit, OnDestroy {
  @ViewChild('gpuCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  gridService = inject(GridService);
  private cdr = inject(ChangeDetectorRef);
  private engine = new WebGPUEngine();
  webGpuSupported = signal(true);
  editorMode = signal<'select' | 'pan' | 'connect' | 'paint' | 'paint-floor'>('select');
  paintTool = signal<'brush' | 'rectangle'>('rectangle');
  dragStartPoint = signal<{ x: number; z: number } | null>(null);
  dragEndPoint = signal<{ x: number; z: number } | null>(null);

  connectSourceId = signal<string | null>(null);

  // Paint Brush State
  paintObjectEnabled = signal(true);
  paintFloorEnabled = signal(false);
  brushShape = signal<string>('isometric-cube.svg');
  brushObjectColor = signal<string>('#3b82f6');
  brushFloorColor = signal<string>('#ffffff');
  activePath = signal<{ x: number; y: number }[]>([]); // Current drawing path
  connectionStyle = signal<'straight' | 'rounded'>('straight');
  currentLineType = signal<'solid' | 'dashed'>('solid');
  previewPoint = signal<{ x: number; y: number } | null>(null);
  hoveredNodeId = signal<string | null>(null);
  availableSvgs = signal<string[]>([
    'isometric-cube.svg',
    'isometric-sphere.svg',
    'isometric-box.svg',
    'isometric-opa.cube.svg',
    'isometric-opa.cylinder.svg',
    'isometric-pyramid.svg',
    'isometric-cylinder.svg',
    'isometric-cone.svg',
    'isometric-prism.svg',
    'module-box.svg',
  ]);
  recentColors = computed(() => {
    // Reactive dependency on nodes and connections
    const nodes = this.gridService.nodes();
    const connections = this.gridService.connections();

    // Default palette
    const defaults = ['#3b82f6', '#FFFFFF', '#e2e8f0', '#1e293b'];
    const colors = new Set<string>(defaults.map((c) => c.toLowerCase()));

    // Collect used colors
    nodes.forEach((n) => {
      if (n.color) colors.add(n.color.toLowerCase());
      if (n.floorColor) colors.add(n.floorColor.toLowerCase());
    });

    connections.forEach((c) => {
      if (c.color) colors.add(c.color.toLowerCase());
    });

    return Array.from(colors);
  });

  zoomLabel = signal(0); // 0% as default relative zoom
  targetRotation = signal(45);
  displayRotation = signal(45);
  currentRotationLabel = computed(() => {
    this.frameCounter(); // Reactive dependency
    let r = this.engine.camera.rotation % 360;
    if (r < 0) r += 360;
    // Use target if we are very close to avoid jitter in label
    const target = this.targetRotation() % 360;
    const normalizedTarget = target < 0 ? target + 360 : target;
    if (Math.abs(r - normalizedTarget) < 0.1) r = normalizedTarget;
    return `${Math.round(r)}°`;
  });
  isFullscreen = signal(false);
  showClearConfirm = signal(false);
  frameCounter = signal(0);

  // ==================== PERFORMANCE MONITORING ====================
  showPerformanceStats = signal(true); // Toggle for dev mode stats

  currentFps = computed(() => {
    this.frameCounter(); // Reactive dependency to update each frame
    return this.engine?.getFps() ?? 60;
  });

  currentQualityLevel = computed(() => {
    this.frameCounter(); // Reactive dependency
    return this.engine?.getQualityLevel() ?? 'high';
  });

  visibleNodesCount = computed(() => {
    return this.positionedNodes().length;
  });

  // Computed signal for grid size based on rotation
  rotatedGridSize = computed(() => {
    const { width, height } = this.gridService.gridSize();
    // For 45 and 225 degrees, width and height are effectively swapped for isometric projection
    // This logic might need to be more robust for other angles, but for 45-degree increments,
    // it's often a simple swap or direct use.
    // Assuming the grid is square or we want to maintain aspect ratio visually.
    // For a simple isometric view, the effective "width" and "height" might not change,
    // but the visual representation on screen might.
    // For now, let's assume it's about the bounding box of the grid.
    // If the rotation is 45 or 225 degrees, the visual width and height might be swapped
    // or more complex. For simplicity, we'll just return the original for now,
    // or a swapped version if the rotation implies it.
    // This is a placeholder and might need more precise calculation based on actual isometric projection.
    if (this.currentRotationLabel() === '45°' || this.currentRotationLabel() === '225°') {
      return { width, height };
    }
    return { width: height, height: width }; // logic might vary but keeping simple
  });

  // Computed signal for connections
  positionedConnections = computed(() => {
    this.frameCounter(); // Reactive dependency
    const conns = this.gridService.connections();
    const nodes = this.gridService.nodes();
    if (!this.engine || !this.engine.initialized) return [];

    // Optimization: Create a Map for O(1) node lookup instead of O(N) .find()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Get visible bounds for frustum culling
    const bounds = this.engine.getVisibleBounds();
    const dpr = window.devicePixelRatio || 1;

    return conns
      .map((conn) => {
        const from = nodeMap.get(conn.fromId);
        const to = nodeMap.get(conn.toId);
        if (!from || !to) return null;

        // Optimization: Basic Frustum Culling for connections
        // If both nodes are far outside the visible bounds, skip heavy path projection
        if (bounds) {
          const margin = 5;
          const isFromOut =
            from.position.x < bounds.x - margin ||
            from.position.x > bounds.x + bounds.width + margin ||
            from.position.y < bounds.y - margin ||
            from.position.y > bounds.y + bounds.height + margin;
          const isToOut =
            to.position.x < bounds.x - margin ||
            to.position.x > bounds.x + bounds.width + margin ||
            to.position.y < bounds.y - margin ||
            to.position.y > bounds.y + bounds.height + margin;

          if (isFromOut && isToOut) return null;
        }

        // Clone/Prepare path points
        let rawPath = conn.path ? [...conn.path] : [from.position, to.position];
        if (!conn.path && from.position.x !== to.position.x && from.position.y !== to.position.y) {
          rawPath = [from.position, { x: to.position.x, y: from.position.y }, to.position];
        }

        if (rawPath.length < 2) return null;

        const h = -0.05;
        const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
        const fovFactor = 1.0 / Math.tan(fovRad / 2);

        // CLIPPING & ARROWHEAD CALCULATION ... (Rest of the logic remains the same but now runs on fewer connections)
        const points3D = rawPath.map((p) => ({ ...p }));
        const arrowLen = 0.35;
        const baseOffset = 0.45;

        // Clip logic simplified for brevity here but same as original ...
        const p0 = points3D[0];
        const p1_next = points3D[1];
        const dx0 = p1_next.x - p0.x;
        const dy0 = p1_next.y - p0.y;
        const dist0 = Math.hypot(dx0, dy0);

        const direction = conn.direction || 'forward';
        const isDirected = conn.directed;
        const hasStartArrow = isDirected && (direction === 'reverse' || direction === 'bi');
        const hasEndArrow = isDirected && (direction === 'forward' || direction === 'bi');

        if (dist0 > 0) {
          const offsetStart = baseOffset + (hasStartArrow ? arrowLen : 0);
          points3D[0] = {
            x: p0.x + (dx0 / dist0) * offsetStart,
            y: p0.y + (dy0 / dist0) * offsetStart,
          };
        }

        let arrowPoints = '';
        let arrowPointsStart = '';
        const lastIdx = points3D.length - 1;
        const pEnd = points3D[lastIdx];
        const pPrev = points3D[lastIdx - 1];
        const dxE = pEnd.x - pPrev.x;
        const dyE = pEnd.y - pPrev.y;
        const distE = Math.hypot(dxE, dyE);

        if (distE > 0) {
          const offsetEnd = baseOffset + (hasEndArrow ? arrowLen : 0);
          points3D[lastIdx] = {
            x: pEnd.x - (dxE / distE) * offsetEnd,
            y: pEnd.y - (dyE / distE) * offsetEnd,
          };

          if (hasEndArrow) {
            const tip = {
              x: pEnd.x - (dxE / distE) * baseOffset,
              y: pEnd.y - (dyE / distE) * baseOffset,
            };
            const aps = this.calculateIsometricArrow(tip, pPrev, h);
            if (aps) arrowPoints = aps;
          }
        }

        if (hasStartArrow && dist0 > 0) {
          const tip = {
            x: p0.x + (dx0 / dist0) * baseOffset,
            y: p0.y + (dy0 / dist0) * baseOffset,
          };
          const aps = this.calculateIsometricArrow(tip, p1_next, h);
          if (aps) arrowPointsStart = aps;
        }

        const projectedPoints = points3D
          .map((p) => {
            const sp = this.engine.worldToScreenCached(p.x, h, p.y);
            return sp ? { x: sp.x / dpr, y: sp.y / dpr } : null;
          })
          .filter((p) => p !== null) as { x: number; y: number }[];

        if (projectedPoints.length < 2) return null;

        const firstZ = this.engine.worldToScreenCached(rawPath[0].x, h, rawPath[0].y)?.z || 10;
        const lastZ =
          this.engine.worldToScreenCached(
            rawPath[rawPath.length - 1].x,
            h,
            rawPath[rawPath.length - 1].y,
          )?.z || 10;
        const scale = (3.5 * fovFactor) / ((firstZ + lastZ) / 2);

        const ptStart = projectedPoints[0];
        const ptEnd = projectedPoints[projectedPoints.length - 1];

        let pathData = '';
        if (conn.style === 'rounded' && projectedPoints.length > 2) {
          pathData = this.getRoundedOrthogonalPath(projectedPoints);
        } else {
          pathData = `M ${projectedPoints.map((p) => `${p.x},${p.y}`).join(' L ')}`;
        }

        return {
          ...conn,
          points: projectedPoints.map((p) => `${p.x},${p.y}`).join(' '),
          pathData,
          arrowPoints,
          arrowPointsStart,
          scale: !isNaN(scale) ? scale : 1,
          firstPoint: { x: ptStart.x, y: ptStart.y },
          lastPoint: { x: ptEnd.x, y: ptEnd.y },
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  });

  // Computed signal for nodes with screen positions
  positionedNodes = computed(() => {
    this.frameCounter(); // Reactive dependency

    // Optimization (Task 7): Spatial Partitioning
    // Query Quadtree for candidate nodes within the view frustum bounds
    const bounds = this.engine?.getVisibleBounds();
    let candidateNodes = bounds
      ? this.gridService.getNodesInBounds(bounds)
      : this.gridService.nodes();

    const canvas = this.canvasRef?.nativeElement;
    if (!canvas || !this.engine || !this.engine.initialized) return [];

    // ==================== ADAPTIVE QUALITY ====================
    // Get quality settings from engine
    const qualitySettings = this.engine.frameController.getQualitySettings();
    const maxNodes = qualitySettings.maxVisibleNodes;

    // Filter active nodes first, then limit
    let activeNodes = candidateNodes.filter((n) => n.active);

    // If we have too many nodes, prioritize by distance to camera center
    if (activeNodes.length > maxNodes) {
      const centerX = this.engine.camera.target.x;
      const centerZ = this.engine.camera.target.z;

      // Sort by distance to camera target and take closest
      activeNodes = activeNodes
        .map((n) => ({
          node: n,
          dist: Math.hypot(n.position.x - centerX, n.position.y - centerZ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, maxNodes)
        .map((item) => item.node);
    }

    const dpr = window.devicePixelRatio || 1;
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    const fovFactor = 1.0 / Math.tan(fovRad / 2);
    const scaleBase = 3.6;

    // Adaptive LOD thresholds based on quality level
    const lodHighThreshold = qualitySettings.lodHighThreshold;
    const lodMediumThreshold = qualitySettings.lodMediumThreshold;

    return activeNodes
      .map((node) => {
        // Use cached projection when available for static nodes
        const screenPos = this.engine.worldToScreenCached(node.position.x, -0.1, node.position.y);
        if (!screenPos) return null;

        const scale = (scaleBase * fovFactor) / screenPos.z;

        // ==================== ADAPTIVE LOD ====================
        // LOD thresholds adjust based on detected performance
        let lod: 'low' | 'medium' | 'high' = 'high';
        if (scale < lodMediumThreshold) lod = 'low';
        else if (scale < lodHighThreshold) lod = 'medium';

        return {
          ...node,
          screenX: screenPos.x / dpr,
          screenY: screenPos.y / dpr,
          z: screenPos.z,
          scale: scale,
          zIndex: 1000 - Math.floor(screenPos.z * 10),
          lod,
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .sort((a, b) => b.z - a.z); // Sort back to front
  });

  // Computed signal for paint preview rectangle
  paintPreviewNodes = computed(() => {
    const start = this.dragStartPoint();
    const end = this.dragEndPoint();
    if (!start || !end) return [];

    // Safety check just in case signals are stale
    if (!this.canvasRef?.nativeElement || !this.engine?.initialized) return [];

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const nodes = [];
    const dpr = window.devicePixelRatio || 1;
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    const fovFactor = 1.0 / Math.tan(fovRad / 2);
    // Use slightly larger scale or distinct style for preview
    const scaleBase = 3.6;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const screenPos = this.engine.worldToScreen(x, -0.1, z);
        if (screenPos) {
          const scale = (scaleBase * fovFactor) / screenPos.z;
          nodes.push({
            x: screenPos.x / dpr,
            y: screenPos.y / dpr,
            z: screenPos.z,
            scale,
            zIndex: 1000 - Math.floor(screenPos.z * 10) + 1, // Slightly above?
          });
        }
      }
    }
    return nodes.sort((a, b) => b.z - a.z);
  });

  // Preview for Selection Rectangle
  selectionPreviewNodes = computed(() => {
    // Only show if dragging in Select Mode
    if (this.editorMode() !== 'select' || !this.dragStartPoint() || !this.dragEndPoint()) {
      return [];
    }

    const start = this.dragStartPoint()!;
    const end = this.dragEndPoint()!;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const nodes = [];
    const dpr = window.devicePixelRatio || 1;
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    const fovFactor = 1.0 / Math.tan(fovRad / 2);
    // Use slightly larger scale or distinct style for preview
    const scaleBase = 3.6;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        // Only visualize if node exists? Or just grid cells?
        // For selection, usually we highlight everything in the box.
        const screenPos = this.engine.worldToScreen(x, -0.1, z);
        if (screenPos) {
          const scale = (scaleBase * fovFactor) / screenPos.z;
          nodes.push({
            x: screenPos.x / dpr,
            y: screenPos.y / dpr,
            z: screenPos.z,
            scale,
            zIndex: 1000 - Math.floor(screenPos.z * 10) + 1,
          });
        }
      }
    }
    return nodes.sort((a, b) => b.z - a.z);
  });

  private animationFrameId: number | null = null;
  private isDragging = false;
  protected lastMousePos = { x: 0, y: 0 };
  private mouseDownTime = 0;
  private isAdditiveSelection = false;

  @Input() set nodes(value: FossFlowNode[]) {
    if (value) {
      if (value.length === 0) {
        this.initializeDefaultGrid();
      } else {
        this.gridService.nodes.set(value);
      }
    }
  }

  @Input() set gridSize(value: { width: number; height: number }) {
    if (value) {
      const currentSize = this.gridService.gridSize();
      if (currentSize.width !== value.width || currentSize.height !== value.height) {
        this.gridService.initializeGrid(value.width, value.height);
      }
    }
  }

  @Output() nodesChange = new EventEmitter<FossFlowNode[]>();

  selectedNode = signal<any>(null);
  selectedConnection = signal<FossFlowConnection | null>(null);

  constructor() {
    effect(() => {
      const selectedId = this.gridService.selectedNodeId();
      if (selectedId) {
        const node = this.gridService.nodes().find((n) => n.id === selectedId);
        this.selectedNode.set(node ? { ...node } : null);
      } else {
        this.selectedNode.set(null);
      }
    });

    effect(() => {
      const selectedId = this.gridService.selectedConnectionId();
      if (selectedId) {
        const conn = this.gridService.connections().find((c) => c.id === selectedId);
        this.selectedConnection.set(conn ? { ...conn } : null);
      } else {
        this.selectedConnection.set(null);
      }
    });

    effect(() => {
      const nodes = this.gridService.nodes();
      if (nodes.length > 0) {
        this.nodesChange.emit(nodes);
      }
    });
  }

  private initializeDefaultGrid() {
    this.gridService.initializeGrid(100, 100);
  }

  async ngOnInit() {
    if (this.gridService.nodes().length === 0) {
      this.initializeDefaultGrid();
    }

    const canvas = this.canvasRef.nativeElement;
    const success = await this.engine.init(canvas);
    this.webGpuSupported.set(success);

    if (success) {
      this.resetView();
      this.handleResize();
      // Optimization: Rely on @HostListener for resize to avoid duplicate listeners
      this.startRenderLoop();
    }
  }

  ngOnDestroy() {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.engine.destroy();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    const speed = 1.0;
    switch (event.key) {
      case 'ArrowUp':
        this.engine.camera.moveIsometric('up', speed);
        break;
      case 'ArrowDown':
        this.engine.camera.moveIsometric('down', speed);
        break;
      case 'ArrowLeft':
        this.engine.camera.moveIsometric('left', speed);
        break;
      case 'ArrowRight':
        this.engine.camera.moveIsometric('right', speed);
        break;
      case 'v':
      case 'V':
        this.editorMode.set('select');
        break;
      case 'h':
      case 'H':
        this.editorMode.set('pan');
        break;
      case 'c':
      case 'C':
        this.editorMode.set('connect');
        break;
      case 'z':
      case 'Z':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (event.shiftKey) this.gridService.redo();
          else this.gridService.undo();
        }
        break;
      case 'y':
      case 'Y':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.gridService.redo();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (this.editorMode() === 'connect' && this.activePath().length > 0) {
          // Cancel current path drawing steps
          this.activePath.update((p) => {
            if (p.length <= 1) {
              this.connectSourceId.set(null);
              return [];
            }
            return p.slice(0, -1);
          });
        } else {
          this.deleteSelected();
        }
        break;
    }
  }

  @HostListener('window:resize')
  onResize() {
    this.handleResize();
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange() {
    this.isFullscreen.set(!!document.fullscreenElement);
  }

  private handleResize = () => {
    const canvas = this.canvasRef.nativeElement;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.engine.updateCamera(canvas.width / canvas.height);
  };

  private startRenderLoop() {
    const render = () => {
      if (!this.canvasRef.nativeElement) return;

      // Ultra-fast interpolation for smooth but snappy rotation
      const currentRot = this.engine.camera.rotation;
      const targetRot = this.targetRotation();

      // Handle 360 wrap around for smooth lerp
      let diff = targetRot - currentRot;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;

      this.engine.camera.rotation = currentRot + diff * 0.2;

      this.engine.updateCamera(
        this.canvasRef.nativeElement.width / this.canvasRef.nativeElement.height,
      );

      // Attempt to render with GPU
      // Returns false if frame was skipped due to adaptive quality (potato mode)
      const rendered = this.engine.render(
        this.gridService.nodes(),
        this.gridService.selectedNodeId(),
      );

      if (rendered) {
        // ONLY update UI signals if we actually rendered the GPU frame
        // This eliminates the "sliding" effect where DOM moves but ground doesn't
        this.frameCounter.update((v) => v + 1);

        // Force synchronous change detection to align with the screen refresh
        this.cdr.detectChanges();
      }

      this.animationFrameId = requestAnimationFrame(render);
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  // Paint helper
  private performPaintAt(clientX: number, clientY: number): any | null {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const ray = this.engine.camera.getRay(x, y, rect.width, rect.height);
    const hit = this.engine.camera.intersectPlaneXZ(ray);

    if (hit) {
      const gx = Math.round(hit.x);
      const gz = Math.round(hit.z);
      const node = this.gridService.nodes().find((n) => n.position.x === gx && n.position.y === gz);

      if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
        const updates: Partial<FossFlowNode> = {};
        let hasUpdates = false;

        // Object Paint Logic
        if (this.paintObjectEnabled()) {
          updates.active = true;
          if (this.brushShape()) updates.shape3D = this.brushShape();
          if (this.brushObjectColor()) updates.color = this.brushObjectColor();
          hasUpdates = true;
        }

        // Floor Paint Logic
        if (this.paintFloorEnabled() && this.brushFloorColor()) {
          updates.floorColor = this.brushFloorColor();
          hasUpdates = true;
        }

        if (hasUpdates) {
          if (node) {
            // Optimize: check if update is needed
            let changed = false;
            if (this.paintObjectEnabled()) {
              if (!node.active || node.shape3D !== updates.shape3D || node.color !== updates.color)
                changed = true;
            }
            if (this.paintFloorEnabled()) {
              if (node.floorColor !== updates.floorColor) changed = true;
            }

            if (changed) this.gridService.updateNode(node.id, updates);
          } else {
            // If node doesn't exist, it means it's outside the initialized grid.
            // We should not create new nodes outside the grid bounds in paint mode.
            // The gridService.initializeGrid creates a dense grid, so `node` should always be found if within bounds.
            // If `node` is null, it's an invalid paint target.
          }
        }
      }
      return node;
    }
    return null;
  }

  onClick(event: MouseEvent) {
    if (this.editorMode() === 'pan') return;

    const duration = Date.now() - this.mouseDownTime;
    if (duration > 250) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const ray = this.engine.camera.getRay(x, y, rect.width, rect.height);
    const hit = this.engine.camera.intersectPlaneXZ(ray);

    if (hit) {
      const gx = Math.round(hit.x);
      const gz = Math.round(hit.z);
      const node = this.gridService.nodes().find((n) => n.position.x === gx && n.position.y === gz);

      if (this.editorMode() === 'select') {
        const isMulti = event.ctrlKey || event.metaKey || event.shiftKey;
        if (node) {
          this.gridService.selectNode(node.id, isMulti);
        } else {
          if (!isMulti) this.gridService.selectNode(null);
        }
      } else if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
        // For click in paint mode, if it's brush, it's already handled by performPaintAt in mousedown.
        // If it's rectangle, we don't do anything on click, only on mouseup.
        if (this.paintTool() === 'brush') {
          this.performPaintAt(event.clientX, event.clientY);
        }
      } else if (this.editorMode() === 'connect') {
        if (node) {
          const path = this.activePath();
          if (path.length === 0) {
            // Start of a new path
            this.activePath.set([node.position]);
            this.connectSourceId.set(node.id);
          } else {
            // Check if we clicked the same node twice or a final node to finish
            const lastPoint = path[path.length - 1];
            const isClickingLast =
              lastPoint.x === node.position.x && lastPoint.y === node.position.y;

            if (isClickingLast || node.active) {
              // Finalize connection
              if (path.length > 1 || (path.length === 1 && this.connectSourceId() !== node.id)) {
                const finalPath = isClickingLast ? path : [...path, node.position];
                this.gridService.addManualConnection(
                  this.connectSourceId()!,
                  node.id,
                  true,
                  finalPath,
                  this.connectionStyle(),
                  this.currentLineType(),
                );
              }
              this.activePath.set([]);
              this.connectSourceId.set(null);
            } else {
              // Add waypoint to zig-zag
              this.activePath.update((p) => [...p, node.position]);
            }
          }
        } else {
          this.activePath.set([]);
          this.connectSourceId.set(null);
        }
      }
    } else {
      this.gridService.selectNode(null);
      this.connectSourceId.set(null);
    }
  }

  onMouseDown(event: MouseEvent) {
    this.mouseDownTime = Date.now();
    this.lastMousePos = { x: event.clientX, y: event.clientY };
    if (
      this.editorMode() === 'pan' ||
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && event.shiftKey && this.editorMode() !== 'select')
    ) {
      this.isDragging = true;
    } else if (
      (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') &&
      event.button === 0
    ) {
      this.isDragging = true;
      if (this.paintTool() === 'brush') {
        // Trigger paint immediately on click/down for brush
        this.performPaintAt(event.clientX, event.clientY);
      } else {
        // Rectangle mode: Start tracking point
        const hit = this.getHitFromMouse(event.clientX, event.clientY);
        if (hit) {
          const p = { x: Math.round(hit.x), z: Math.round(hit.z) };
          this.dragStartPoint.set(p);
          this.dragEndPoint.set(p);
        }
      }
    } else if (this.editorMode() === 'select' && event.button === 0) {
      this.isDragging = true;
      this.isAdditiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      const hit = this.getHitFromMouse(event.clientX, event.clientY);
      if (hit) {
        const p = { x: Math.round(hit.x), z: Math.round(hit.z) };
        this.dragStartPoint.set(p);
        this.dragEndPoint.set(p);
      }
    }
  }

  // Helper to get hit without reusing full logic everywhere
  private getHitFromMouse(clientX: number, clientY: number) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ray = this.engine.camera.getRay(x, y, rect.width, rect.height);
    return this.engine.camera.intersectPlaneXZ(ray);
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // 1. Drag Logic
    if (this.isDragging) {
      // Pan Logic
      if (
        this.editorMode() === 'pan' ||
        event.buttons === 4 ||
        event.buttons === 2 ||
        (event.buttons === 1 && event.shiftKey && this.editorMode() !== 'select')
      ) {
        const dx = event.clientX - this.lastMousePos.x;
        const dy = event.clientY - this.lastMousePos.y;
        this.engine.camera.panScreen(dx, dy, rect.width, rect.height);
        this.lastMousePos = { x: event.clientX, y: event.clientY };
        return;
      }

      // Paint Drag Logic
      if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
        if (this.paintTool() === 'brush') {
          this.performPaintAt(event.clientX, event.clientY);
        } else {
          // Rectangle update
          const hit = this.getHitFromMouse(event.clientX, event.clientY);
          if (hit) {
            this.dragEndPoint.set({ x: Math.round(hit.x), z: Math.round(hit.z) });
          }
        }
      } else if (this.editorMode() === 'select') {
        // Rectangle update
        const hit = this.getHitFromMouse(event.clientX, event.clientY);
        if (hit) {
          this.dragEndPoint.set({ x: Math.round(hit.x), z: Math.round(hit.z) });
        }
      }
    }

    // 2. Hover Logic (only if not panning)
    if (
      this.editorMode() === 'connect' ||
      this.editorMode() === 'select' ||
      this.editorMode() === 'paint' ||
      this.editorMode() === 'paint-floor'
    ) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const ray = this.engine.camera.getRay(x, y, rect.width, rect.height);
      const hit = this.engine.camera.intersectPlaneXZ(ray);

      if (hit) {
        const gx = Math.round(hit.x);
        const gz = Math.round(hit.z);

        // Hover Node Logic
        const node = this.gridService
          .nodes()
          .find((n) => n.position.x === gx && n.position.y === gz);

        if (node) {
          this.hoveredNodeId.set(node.id);
        } else {
          this.hoveredNodeId.set(null);
        }

        // Update Preview Point for Ghost Line
        if (this.editorMode() === 'connect') {
          // If hovering a valid target node (not self), snap to it. Otherwise follow cursor smoothly.
          if (node && this.activePath().length > 0 && this.connectSourceId() !== node.id) {
            this.previewPoint.set({ x: node.position.x, y: node.position.y });
          } else {
            this.previewPoint.set({ x: hit.x, y: hit.z });
          }
        }
      } else {
        this.previewPoint.set(null);
        this.hoveredNodeId.set(null);
      }
    } else {
      this.previewPoint.set(null);
      this.hoveredNodeId.set(null);
    }
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isDragging) {
      if (
        (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') &&
        this.paintTool() === 'rectangle'
      ) {
        this.applyPaintRectangle();
      } else if (this.editorMode() === 'select') {
        const start = this.dragStartPoint();
        const end = this.dragEndPoint();
        if (start && end && (start.x !== end.x || start.z !== end.z)) {
          this.applySelectionRectangle();
        }
      }
    }
    this.isDragging = false;
    this.dragStartPoint.set(null);
    this.dragEndPoint.set(null);
  }

  private applySelectionRectangle() {
    const start = this.dragStartPoint();
    const end = this.dragEndPoint();
    if (!start || !end) return;

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const nodes = this.gridService.nodes();
    let selectedIds: string[] = [];

    // If additive, start with existing selection
    if (this.isAdditiveSelection) {
      selectedIds = [...this.gridService.selectedNodeIds()];
    }

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const node = nodes.find((n) => n.position.x === x && n.position.y === z);
        if (node) {
          if (!selectedIds.includes(node.id)) {
            selectedIds.push(node.id);
          }
        }
      }
    }

    // Set selection
    this.gridService.setSelection(selectedIds);
  }

  private applyPaintRectangle() {
    const start = this.dragStartPoint();
    const end = this.dragEndPoint();
    if (!start || !end) return;

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const nodes = this.gridService.nodes();
    const shape = this.brushShape();
    const objColor = this.brushObjectColor();
    const floorColor = this.brushFloorColor();

    const batchUpdates: { id: string; changes: Partial<FossFlowNode> }[] = [];

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        let node = nodes.find((n) => n.position.x === x && n.position.y === z);

        if (node) {
          // Update existing
          const updates: Partial<FossFlowNode> = {};

          if (this.paintObjectEnabled()) {
            updates.active = true;
            updates.shape3D = shape;
            updates.color = objColor;
          }

          if (this.paintFloorEnabled()) {
            updates.floorColor = floorColor;
          }

          if (Object.keys(updates).length > 0) {
            batchUpdates.push({ id: node.id, changes: updates });
          }
        }
      }
    }

    if (batchUpdates.length > 0) {
      this.gridService.updateManyNodes(batchUpdates);
    }
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    // Progressive zoom based on event.deltaY
    // Use a multiplier for smoothness. Pinch gestures typically send deltaY with Ctrl key.
    const multiplier = 1 + Math.abs(event.deltaY) * 0.001;
    if (event.deltaY > 0) {
      this.multiplyZoom(multiplier);
    } else {
      this.multiplyZoom(1 / multiplier);
    }
  }

  zoomIn() {
    this.multiplyZoom(0.8);
  }
  zoomOut() {
    this.multiplyZoom(1.25);
  }

  rotateLeft() {
    this.targetRotation.update((v: number) => v - 45);
  }

  rotateRight() {
    this.targetRotation.update((v: number) => v + 45);
  }

  private multiplyZoom(factor: number) {
    // Zoom range: 200% to 325% (FOV 10.285 to 15)
    // Label shows relative to default 250% (FOV 12.857)
    let fov = this.engine.camera.zoom * factor;
    fov = Math.max(10.285, Math.min(15, fov));
    this.engine.camera.zoom = fov;
    this.syncZoomLabel();
  }

  private syncZoomLabel() {
    // Label relative to default 250% (FOV 12.857): show as 0%
    // Formula: (12.857 / FOV - 1) * 100
    const p = Math.round((12.857 / this.engine.camera.zoom - 1) * 100);
    this.zoomLabel.set(p);
  }

  selectObject(svgName: string, node: any) {
    this.updateNode(node.id, { shape3D: svgName, active: true });
  }

  removeObject(node: any) {
    this.updateNode(node.id, { active: false });
  }

  onFloorColorInput(event: Event, node: any) {
    const input = event.target as HTMLInputElement;
    this.updateNode(node.id, { floorColor: input.value });
  }

  onObjectColorInput(event: Event, node: any) {
    const input = event.target as HTMLInputElement;
    this.updateNode(node.id, { color: input.value });
  }

  applyRecentColorToFloor(color: string, node: any) {
    this.updateNode(node.id, { floorColor: color });
  }

  applyRecentColorToObject(color: string, node: any) {
    this.updateNode(node.id, { color: color });
  }

  updateNode(id: string, updates: Partial<FossFlowNode>) {
    this.gridService.updateNode(id, updates);
    // The effect in the constructor will automatically update this.selectedNode()
    // when gridService.nodes() changes, but we can do a local set for immediate feedback
    const current = this.selectedNode();
    if (current?.id === id) {
      this.selectedNode.set({ ...current, ...updates });
    }
  }

  resetView() {
    const size = this.gridService.gridSize();
    // Calculate exact center of the grid
    const cx = (size.width - 1) / 2;
    const cz = (size.height - 1) / 2;
    this.engine.camera.setIsometric(cx, cz, 45);
    this.targetRotation.set(45);
    // Camera.setIsometric() sets zoom to 12.857 (showing as 0%) automatically
    this.syncZoomLabel();
    this.cdr.detectChanges();
  }

  toggleFullscreen() {
    const container = this.canvasRef.nativeElement.parentElement;
    if (!container) return;

    if (!document.fullscreenElement) {
      container
        .requestFullscreen()
        .then(() => {
          this.isFullscreen.set(true);
        })
        .catch(() => {
          this.isFullscreen.set(false);
        });
    } else {
      document.exitFullscreen().then(() => {
        this.isFullscreen.set(false);
      });
    }
  }

  confirmClear() {
    this.gridService.clearGrid();
    this.showClearConfirm.set(false);
  }

  // Max connections handler removed as auto-connect is disabled

  onConnectionClick(event: MouseEvent, id: string) {
    event.stopPropagation();
    this.gridService.selectConnection(id);
  }

  updateConnection(id: string, updates: Partial<FossFlowConnection>) {
    this.gridService.updateConnection(id, updates);
    if (this.selectedConnection()?.id === id) {
      this.selectedConnection.update((c) => (c ? { ...c, ...updates } : null));
    }
  }

  onConnectionColorInput(event: Event, id: string) {
    const input = event.target as HTMLInputElement;
    this.updateConnection(id, { color: input.value });
  }

  deleteSelected() {
    if (this.gridService.selectedConnectionId()) {
      this.gridService.removeConnection(this.gridService.selectedConnectionId()!);
    } else {
      const selectedIds = this.gridService.selectedNodeIds();
      if (selectedIds.length > 0) {
        // "Removing" object means setting active=false.
        // We use updateManyNodes.
        const updates = selectedIds.map((id) => ({ id, changes: { active: false } }));
        this.gridService.updateManyNodes(updates);
        // Deselect or keep selected? Usually keep selected so you can undo easily or see they are gone (but they are hidden).
        // If active=false, they disappear from view (except maybe grid).
        // Let's clear selection.
        this.gridService.setSelection([]);
      }
    }
  }

  updateSelectedNodes(changes: Partial<FossFlowNode>) {
    const selectedIds = this.gridService.selectedNodeIds();
    if (selectedIds.length === 0) return;

    const updates = selectedIds.map((id) => ({ id, changes }));
    this.gridService.updateManyNodes(updates);
  }

  // Drag Endpoints Logic
  isDraggingEndpoint = false;
  draggedConnectionId: string | null = null;
  draggedEndpointType: 'start' | 'end' | null = null;

  // Helper to resolve direction safely
  getAllowedDirection(conn: any): 'forward' | 'reverse' | 'bi' {
    return conn.direction || 'forward';
  }

  // Helper to calculate isometric arrow points
  private calculateIsometricArrow(
    tip: { x: number; y: number },
    fromPoint: { x: number; y: number },
    h: number,
  ): string | null {
    const arrowLen = 0.35;
    const w = 0.25;
    const dpr = window.devicePixelRatio || 1;

    const dx = tip.x - fromPoint.x;
    const dy = tip.y - fromPoint.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return null;

    const dirX = dx / dist;
    const dirY = dy / dist;

    // Tip is at 'tip'
    // Base center is back along direction
    const baseC = { x: tip.x - dirX * arrowLen, y: tip.y - dirY * arrowLen };

    // Perpendicular vector for width (z-up logic mapped to y here)
    const perpX = -dirY;
    const perpY = dirX;

    const left = { x: baseC.x + perpX * (w / 2), y: baseC.y + perpY * (w / 2) };
    const right = { x: baseC.x - perpX * (w / 2), y: baseC.y - perpY * (w / 2) };

    const sTip = this.engine.worldToScreen(tip.x, h, tip.y);
    const sLeft = this.engine.worldToScreen(left.x, h, left.y);
    const sRight = this.engine.worldToScreen(right.x, h, right.y);

    if (sTip && sLeft && sRight) {
      return [
        `${sTip.x / dpr},${sTip.y / dpr}`,
        `${sLeft.x / dpr},${sLeft.y / dpr}`,
        `${sRight.x / dpr},${sRight.y / dpr}`,
      ].join(' ');
    }
    return null;
  }

  // Method to activate connect mode with a specific style
  setConnectMode(style: 'straight' | 'rounded') {
    this.editorMode.set('connect');
    this.connectionStyle.set(style);
  }

  // Helper to generate path D string
  private getRoundedOrthogonalPath(points: { x: number; y: number }[]): string {
    if (points.length < 3) {
      if (points.length === 2)
        return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
      return '';
    }

    // Constant radius for corners (in screen pixels, roughly)
    const radius = 15;

    let d = `M ${points[0].x},${points[0].y}`;

    // Iterate from 1st point to (N-1)th point, rounding corners at i
    for (let i = 1; i < points.length - 1; i++) {
      const pPrev = points[i - 1];
      const pCurr = points[i];
      const pNext = points[i + 1];

      const v1x = pCurr.x - pPrev.x;
      const v1y = pCurr.y - pPrev.y;
      const dist1 = Math.hypot(v1x, v1y);

      const v2x = pNext.x - pCurr.x;
      const v2y = pNext.y - pCurr.y;
      const dist2 = Math.hypot(v2x, v2y);

      // Clamp radius to half available length
      const r = Math.min(radius, dist1 / 2, dist2 / 2);

      if (r < 1e-3) {
        d += ` L ${pCurr.x},${pCurr.y}`;
        continue;
      }

      // Clip the line before the corner
      const startX = pCurr.x - (v1x / dist1) * r;
      const startY = pCurr.y - (v1y / dist1) * r;

      // Start of next segment after corner
      const endX = pCurr.x + (v2x / dist2) * r;
      const endY = pCurr.y + (v2y / dist2) * r;

      d += ` L ${startX},${startY} Q ${pCurr.x},${pCurr.y} ${endX},${endY}`;
    }

    d += ` L ${points[points.length - 1].x},${points[points.length - 1].y}`;
    return d;
  }

  activePathData = computed(() => {
    // Generate visual path for active drawing using rounded logic if active style is rounded
    const points = this.positionedActivePathPoints(); // static points from clicks

    // ADDING GHOST LINE: If we have a previewPoint, consider it the 'next' dynamic point
    const preview = this.previewPoint();
    const dpr = window.devicePixelRatio || 1;
    const style = this.connectionStyle();

    let allPoints = [...points];

    if (this.activePath().length > 0 && preview && this.engine.initialized) {
      // Project preview point to screen
      const sp = this.engine.worldToScreen(preview.x, -0.05, preview.y);
      if (sp) {
        allPoints.push({ x: sp.x / dpr, y: sp.y / dpr });
      }
    }

    if (allPoints.length < 2) return '';

    if (style === 'rounded') {
      return this.getRoundedOrthogonalPath(allPoints);
    } else {
      return `M ${allPoints.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    }
  });

  // Refactored positionedActivePath to return points array for reuse
  positionedActivePathPoints = computed(() => {
    const path = this.activePath();
    if (path.length < 1 || !this.engine.initialized) return [];
    const dpr = window.devicePixelRatio || 1;
    return path
      .map((p) => {
        const sp = this.engine.worldToScreen(p.x, -0.05, p.y);
        return sp ? { x: sp.x / dpr, y: sp.y / dpr } : null;
      })
      .filter((p): p is { x: number; y: number } => p !== null);
  });

  // Deprecated usage of positionedActivePath string
  positionedActivePath = computed(() => {
    const pts = this.positionedActivePathPoints();
    return pts.map((p) => `${p.x},${p.y}`).join(' ');
  });

  onHandleMouseDown(event: MouseEvent, connId: string, type: 'start' | 'end') {
    event.stopPropagation();
    event.preventDefault();
    this.isDraggingEndpoint = true;
    this.draggedConnectionId = connId;
    this.draggedEndpointType = type;
    this.lastMousePos = { x: event.clientX, y: event.clientY };
  }
}

export { FossflowEditorComponent as ZflowEditorComponent };
