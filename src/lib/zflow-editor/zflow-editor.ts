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
  PLATFORM_ID,
  AfterViewInit,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GridService } from '../services/grid.service';
import { SelectionService } from '../services/selection.service';
import { HistoryService } from '../services/history.service';
import { StorageService } from '../services/storage.service';
import { ConnectionService } from '../services/connection.service';
import { WebGPUEngine } from '../webgpu/engine';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';
import { ModalComponent } from '../components/ui/modal/modal';
import { BottomToolbar } from '../components/toolbar/bottom-toolbar/bottom-toolbar';
import { TopToolbar } from '../components/toolbar/top-toolbar/top-toolbar';
import { SelectionSidebar } from '../components/sidebar/selection-sidebar/selection-sidebar';
import { NodeSidebar } from '../components/sidebar/node-sidebar/node-sidebar';
import { PaintSidebar } from '../components/sidebar/paint-sidebar/paint-sidebar';
import { ConnectionSidebar } from '../components/sidebar/connection-sidebar/connection-sidebar';
import { PerformanceMonitorComponent } from '../components/performance-monitor/performance-monitor';

@Component({
  selector: 'zflow-editor',
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
  providers: [GridService, SelectionService, HistoryService, StorageService, ConnectionService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './zflow-editor.html',
  styleUrl: './zflow-editor.css',
})
export class ZFlowEditor implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('gpuCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  gridService = inject(GridService);
  selectionService = inject(SelectionService);
  historyService = inject(HistoryService);
  connectionService = inject(ConnectionService);
  private cdr = inject(ChangeDetectorRef);
  private platformId = inject(PLATFORM_ID);
  private engine!: WebGPUEngine;

  undoBound = () => this.undo();
  redoBound = () => this.redo();

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
  ]);
  lastFinishTime = 0; // Timestamp to prevent immediate restart
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
    if (!isPlatformBrowser(this.platformId) || !this.engine) return '0°';
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
    if (!isPlatformBrowser(this.platformId) || !this.engine || !this.engine.initialized) return [];

    // Optimization: Create a Map for O(1) node lookup instead of O(N) .find()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Get visible bounds for frustum culling
    const bounds = this.engine.getVisibleBounds();
    const dpr = isPlatformBrowser(this.platformId) ? window.devicePixelRatio || 1 : 1;

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

    // ==================== ADAPTIVE QUALITY ====================
    // Get quality settings from engine
    const qualitySettings = this.engine.frameController.getQualitySettings();
    const maxNodes = qualitySettings.maxVisibleNodes;

    // Use GridService.activeNodes() directly for reactiveness
    // This avoids race conditions with the Quadtree
    let activeNodes = this.gridService.activeNodes();

    // If we have too many nodes, prioritize by distance to camera center
    if (activeNodes.length > maxNodes) {
      const centerX = this.engine.camera.target.x;
      const centerZ = this.engine.camera.target.z;

      // Sort by distance to camera target and take closest
      activeNodes = activeNodes
        .map((n: FossFlowNode) => ({
          node: n,
          dist: Math.hypot(n.position.x - centerX, n.position.y - centerZ),
        }))
        .sort((a: any, b: any) => a.dist - b.dist)
        .slice(0, maxNodes)
        .map((item: any) => item.node);
    }

    const dpr = isPlatformBrowser(this.platformId) ? window.devicePixelRatio || 1 : 1;
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    const fovFactor = 1.0 / Math.tan(fovRad / 2);
    const scaleBase = 3.6;

    // Adaptive LOD thresholds based on quality level
    const lodHighThreshold = qualitySettings.lodHighThreshold;
    const lodMediumThreshold = qualitySettings.lodMediumThreshold;

    return activeNodes
      .map((node: FossFlowNode) => {
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
      .filter((n: any): n is NonNullable<typeof n> => n !== null)
      .sort((a: any, b: any) => b.z - a.z); // Sort back to front
  });

  // Computed signal for paint preview rectangle
  paintPreviewNodes = computed(() => {
    const start = this.dragStartPoint();
    const end = this.dragEndPoint();
    if (!start || !end) return [];

    // Safety check just in case signals are stale
    if (!isPlatformBrowser(this.platformId) || !this.engine || !this.engine.initialized) return [];

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const nodes = [];
    const dpr = isPlatformBrowser(this.platformId) ? window.devicePixelRatio || 1 : 1;
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
  private resizeObserver: ResizeObserver | null = null;
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
        // Only push state if there are existing nodes (changing size, not initial init)
        if (this.gridService.nodes().length > 0) {
          this.pushState();
        }
        this.gridService.initializeGrid(value.width, value.height);
      }
    }
  }

  @Output() nodesChange = new EventEmitter<FossFlowNode[]>();

  selectedNode = signal<any>(null);
  selectedConnection = signal<FossFlowConnection | null>(null);

  constructor() {
    console.log('[ZFlowEditor] Constructor start. Platform:', this.platformId);
    if (isPlatformBrowser(this.platformId)) {
      this.engine = new WebGPUEngine();
      console.log('[ZFlowEditor] WebGPUEngine instance created');
    }

    effect(() => {
      const selectedId = this.selectionService.selectedNodeId();
      if (selectedId) {
        const node = this.gridService.nodes().find((n) => n.id === selectedId);
        this.selectedNode.set(node ? { ...node } : null);
      } else {
        this.selectedNode.set(null);
      }
    });

    effect(() => {
      const selectedId = this.selectionService.selectedConnectionId();
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

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      if (this.gridService.nodes().length === 0) {
        this.initializeDefaultGrid();
      }
    }
  }

  async ngAfterViewInit() {
    console.log('[ZFlowEditor] ngAfterViewInit - Starting initialization');

    if (!isPlatformBrowser(this.platformId)) {
      console.warn('[ZFlowEditor] Skipping initialization: Not in browser platform');
      return;
    }

    if (!this.canvasRef) {
      console.error('[ZFlowEditor] Error: canvasRef is null in ngAfterViewInit');
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    if (!canvas) {
      console.error('[ZFlowEditor] Error: nativeElement is null in canvasRef');
      return;
    }

    console.log('[ZFlowEditor] Starting WebGPUEngine.init(canvas)');
    const success = await this.engine.init(canvas);
    console.log('[ZFlowEditor] WebGPU initialization success:', success);

    if (this.engine.initialized) {
      console.log('[ZFlowEditor] Engine is fully initialized');
    }

    this.webGpuSupported.set(success);

    if (success) {
      this.resetView();
      this.handleResize();

      const parent = this.canvasRef.nativeElement?.parentElement;
      if (parent) {
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => {
          this.handleResize();
        });
        this.resizeObserver.observe(parent);
        console.log('[ZFlowEditor] ResizeObserver attached to parent');
      }

      this.startRenderLoop();
    }
  }

  ngOnDestroy() {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // Only destroy engine if it was initialized (i.e., in browser)
    if (isPlatformBrowser(this.platformId) && this.engine) {
      this.engine.destroy();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    const speed = 1.0;
    switch (event.key) {
      case 'Escape':
        // Fix: Clear all connection-related state on Escape
        this.activePath.set([]);
        this.connectSourceId.set(null);
        this.previewPoint.set(null);
        break;
      case 'ArrowUp':
        if (this.engine) this.engine.camera.moveIsometric('up', speed);
        break;
      case 'ArrowDown':
        if (this.engine) this.engine.camera.moveIsometric('down', speed);
        break;
      case 'ArrowLeft':
        if (this.engine) this.engine.camera.moveIsometric('left', speed);
        break;
      case 'ArrowRight':
        if (this.engine) this.engine.camera.moveIsometric('right', speed);
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
          if (event.shiftKey) this.redo();
          else this.undo();
        }
        break;
      case 'y':
      case 'Y':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.redo();
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
    // Guard DOM access for SSR
    if (typeof document === 'undefined') return;

    // Check both browser fullscreen and our custom fullscreen mode
    const editorContainer = document.querySelector('zflow-editor .ff-container');
    if (editorContainer && !document.fullscreenElement) {
      editorContainer.classList.remove('fullscreen-mode');
    }
    const isCustomFullscreen = editorContainer?.classList.contains('fullscreen-mode') || false;
    this.isFullscreen.set(!!document.fullscreenElement || isCustomFullscreen);
    setTimeout(() => this.handleResize(), 0);
  }

  private handleResize = () => {
    const canvas = this.canvasRef.nativeElement;
    if (!canvas || !this.engine) return; // Guard engine call
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
      if (!this.canvasRef.nativeElement || !this.engine) return; // Guard engine call

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
        this.selectionService.selectedNodeId(),
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
    if (!this.engine) return null; // Guard engine call
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const ray = this.engine.camera.getRay(x, y, rect.width, rect.height);
    const hit = this.engine.camera.intersectPlaneXZ(ray);

    if (hit) {
      const gx = Math.round(hit.x);
      const gz = Math.round(hit.z);
      const node = this.gridService.getNodeAt(gx, gz);

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

            if (changed) {
              this.pushState();
              this.gridService.updateNode(node.id, updates);
            }
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
    // Ignore clicks when modal is open
    if (this.showClearConfirm()) return;
    if (!this.engine) return; // Guard engine call

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
      const node = this.gridService.getNodeAt(gx, gz);

      if (this.editorMode() === 'select') {
        const isMulti = event.ctrlKey || event.metaKey || event.shiftKey;
        if (node) {
          this.selectionService.selectNode(node.id, isMulti);
        } else {
          if (!isMulti) this.selectionService.selectNode(null);
        }
      } else if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
        // For click in paint mode, if it's brush, it's already handled by performPaintAt in mousedown.
        // If it's rectangle, we don't do anything on click, only on mouseup.
        if (this.paintTool() === 'brush') {
          this.performPaintAt(event.clientX, event.clientY);
        }
      } else if (this.editorMode() === 'connect') {
        const hit = this.getHitFromMouse(event.clientX, event.clientY);
        if (!hit) return;

        const gx = Math.round(hit.x);
        const gz = Math.round(hit.z);
        const targetNode = this.gridService.getNodeAt(gx, gz);
        const startNode = this.connectSourceId()
          ? this.gridService.nodes().find((n) => n.id === this.connectSourceId())
          : null;

        if (this.activePath().length === 0) {
          // --- STARTING A CONNECTION ---
          // Prevent starting if we just finished one on this same click/mouseup sequence
          if (Date.now() - this.lastFinishTime < 200) return;

          if (targetNode) {
            this.activePath.set([targetNode.position]);
            this.connectSourceId.set(targetNode.id);
          } else {
            this.activePath.set([{ x: gx, y: gz }]);
            this.connectSourceId.set(null);
          }
        } else {
          // --- PLACING WAYPOINT O CONFIRMING FINISH ---
          const path = this.activePath();
          const lastPoint = path[path.length - 1];

          // Check if we are clicking on the same spot as the last waypoint
          const isSameTargetPos = lastPoint.x === gx && lastPoint.y === gz;
          // NEW: Finish directly if it's an active node (has an object)
          const isTargetActive =
            targetNode && targetNode.active && targetNode.id !== this.connectSourceId();

          if (isSameTargetPos || isTargetActive) {
            const finalPos = targetNode ? targetNode.position : { x: gx, y: gz };
            const finalId = targetNode ? targetNode.id : null;

            // Allow finishing if it's not the source or if it's a self-loop with path
            if (finalId !== this.connectSourceId() || path.length > 2) {
              this.finishConnection(finalPos, finalId);
              return;
            }
          }

          // Otherwise, add a waypoint
          const newPoint = targetNode ? targetNode.position : { x: gx, y: gz };

          // Avoid adding exact duplicate waypoints consecutively
          if (newPoint.x !== lastPoint.x || newPoint.y !== lastPoint.y) {
            this.activePath.update((p) => [...p, newPoint]);
          }
        }
      }
    } else {
      this.selectionService.selectNode(null);
      if (this.editorMode() !== 'connect') {
        this.connectSourceId.set(null);
      }
    }
  }

  /**
   * Helper to finalize a connection and reset state correctly
   */
  private finishConnection(targetPos: { x: number; y: number }, targetId: string | null = null) {
    const path = this.activePath();
    const finalPath = [...path, targetPos];

    this.pushState();
    this.gridService.addConnection(
      this.connectSourceId() || `point-${path[0].x}-${path[0].y}`,
      targetId || `point-${targetPos.x}-${targetPos.y}`,
      true,
      finalPath,
      this.connectionStyle(),
      this.currentLineType(),
      undefined,
      undefined,
      true, // Diagonals always allowed now
    );

    // Reset state and do NOT start a new connection automatically
    this.activePath.set([]);
    this.connectSourceId.set(null);
    this.previewPoint.set(null);
    this.lastFinishTime = Date.now();
  }

  onMouseDown(event: MouseEvent) {
    // Ignore mouse events when modal is open
    if (this.showClearConfirm()) return;
    if (!this.engine) return; // Guard engine call

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
    if (!this.engine) return null; // Guard engine call
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ray = this.engine.camera.getRay(x, y, rect.width, rect.height);
    return this.engine.camera.intersectPlaneXZ(ray);
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.engine) return; // Guard engine call
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
        const node = this.gridService.getNodeAt(gx, gz);

        if (node) {
          this.hoveredNodeId.set(node.id);
        } else {
          this.hoveredNodeId.set(null);
        }

        // Update Preview Point for Ghost Line
        if (this.editorMode() === 'connect') {
          // Snap logic for connections
          const connUnderMouse = this.connectionService.getConnectionAt(
            gx,
            gz,
            this.gridService.connections(),
            this.gridService.nodes(),
          );

          if (node) {
            // Snap to node center
            this.previewPoint.set({ x: node.position.x, y: node.position.y });
          } else if (connUnderMouse) {
            // Snap to connection tile center (Junction behavior)
            this.previewPoint.set({ x: gx, y: gz });
          } else {
            // Smooth follow or grid snap
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
      selectedIds = [...this.selectionService.selectedNodeIds()];
    }

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const node = this.gridService.getNodeAt(x, z);
        if (node) {
          if (!selectedIds.includes(node.id)) {
            selectedIds.push(node.id);
          }
        }
      }
    }

    // Set selection
    this.selectionService.setSelection(selectedIds);
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
        let node = this.gridService.getNodeAt(x, z);

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
      this.pushState();
      this.gridService.updateManyNodes(batchUpdates);
    }
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    if (!this.engine) return; // Guard engine call
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
    if (!this.engine) return; // Guard engine call
    this.multiplyZoom(0.8);
  }
  zoomOut() {
    if (!this.engine) return; // Guard engine call
    this.multiplyZoom(1.25);
  }

  rotateLeft() {
    if (!this.engine) return; // Guard engine call
    this.targetRotation.update((v: number) => v - 45);
  }

  rotateRight() {
    if (!this.engine) return; // Guard engine call
    this.targetRotation.update((v: number) => v + 45);
  }

  private multiplyZoom(factor: number) {
    if (!this.engine) return; // Guard engine call
    // Zoom range: 200% to 325% (FOV 10.285 to 15)
    // Label shows relative to default 250% (FOV 12.857)
    let fov = this.engine.camera.zoom * factor;
    fov = Math.max(10.285, Math.min(15, fov));
    this.engine.camera.zoom = fov;
    this.syncZoomLabel();
  }

  private syncZoomLabel() {
    if (!this.engine) return; // Guard engine call
    // Label relative to default 250% (FOV 12.857): show as 0%
    // Formula: (12.857 / FOV - 1) * 100
    const p = Math.round((12.857 / this.engine.camera.zoom - 1) * 100);
    this.zoomLabel.set(p);
  }

  selectObject(svgName: string, node: any) {
    if (!svgName) {
      this.removeObject(node);
      return;
    }
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
    this.pushState();
    this.gridService.updateNode(id, updates);
    // The effect in the constructor will automatically update this.selectedNode()
    // when gridService.nodes() changes, but we can do a local set for immediate feedback
    const current = this.selectedNode();
    if (current?.id === id) {
      this.selectedNode.set({ ...current, ...updates });
    }
  }

  resetView() {
    if (!this.engine) return; // Guard engine call
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
    // Guard DOM access for SSR
    if (typeof document === 'undefined') return;

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
    this.pushState();
    this.gridService.clearGrid();
    if (this.engine) this.engine.clearProjectionCache();
    this.showClearConfirm.set(false);
    this.cdr.detectChanges();
  }

  pushState() {
    this.historyService.pushState({
      nodes: this.gridService.nodes(),
      connections: this.gridService.connections(),
    });
  }

  undo() {
    const state = this.historyService.undo({
      nodes: this.gridService.nodes(),
      connections: this.gridService.connections(),
    });
    if (state) {
      this.gridService.setNodes(state.nodes);
      this.gridService.setConnections(state.connections);
    }
  }

  redo() {
    const state = this.historyService.redo({
      nodes: this.gridService.nodes(),
      connections: this.gridService.connections(),
    });
    if (state) {
      this.gridService.setNodes(state.nodes);
      this.gridService.setConnections(state.connections);
    }
  }

  // Max connections handler removed as auto-connect is disabled

  onConnectionClick(event: MouseEvent, id: string) {
    event.stopPropagation();

    if (this.editorMode() === 'connect' && this.activePath().length > 0) {
      // Joining a connection via click
      const hit = this.getHitFromMouse(event.clientX, event.clientY);
      if (hit) {
        const gx = Math.round(hit.x);
        const gz = Math.round(hit.z);
        this.finishConnection({ x: gx, y: gz }, null);
        return;
      }
    }

    this.selectionService.selectConnection(id);
  }

  updateConnection(id: string, updates: Partial<FossFlowConnection>) {
    this.pushState();
    this.gridService.updateConnection(id, updates);
    if (this.selectedConnection()?.id === id) {
      this.selectedConnection.update((c) => (c ? { ...c, ...updates } : null));
    }
  }

  onConnectionColorInput(event: Event, id: string) {
    const input = event.target as HTMLInputElement;
    this.updateConnection(id, { color: input.value });
  }

  deleteConnection(id: string) {
    this.pushState();
    this.gridService.removeConnection(id);
    // Clear selection if this was the selected connection
    if (this.selectionService.selectedConnectionId() === id) {
      this.selectionService.selectConnection(null);
    }
  }

  deleteSelected() {
    if (this.selectionService.selectedConnectionId()) {
      this.pushState();
      this.gridService.removeConnection(this.selectionService.selectedConnectionId()!);
      this.selectionService.selectConnection(null);
    } else {
      const selectedIds = this.selectionService.selectedNodeIds();
      if (selectedIds.length > 0) {
        // "Removing" object means setting active=false.
        // We use updateManyNodes.
        this.pushState();
        const updates = selectedIds.map((id) => ({ id, changes: { active: false } }));
        this.gridService.updateManyNodes(updates);

        // Clear engine cache for these specific nodes to ensure fresh state if replaced
        if (this.engine) this.engine.clearProjectionCache();

        // Deselect or keep selected? Usually keep selected so you can undo easily or see they are gone (but they are hidden).
        // If active=false, they disappear from view (except maybe grid).
        // Let's clear selection.
        this.selectionService.setSelection([]);
      }
    }
  }

  updateSelectedNodes(changes: Partial<FossFlowNode>) {
    const selectedIds = this.selectionService.selectedNodeIds();
    if (selectedIds.length === 0) return;

    this.pushState();
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
