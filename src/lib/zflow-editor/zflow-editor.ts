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

  private getFovFactor() {
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    return 1.0 / Math.tan(fovRad / 2);
  }

  // ==================== PERFORMANCE MONITORING ====================
  showPerformanceStats = signal(false); // Toggle for dev mode stats

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

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const bounds = this.engine.getVisibleBounds();
    const dpr = window.devicePixelRatio || 1;
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    const fovFactor = 1.0 / Math.tan(fovRad / 2);

    return conns
      .map((conn) => this.projectConnection(conn, nodeMap, dpr, fovFactor, bounds))
      .filter((c): c is NonNullable<typeof c> => c !== null);
  });

  private projectConnection(
    conn: FossFlowConnection,
    nodeMap: Map<string, FossFlowNode>,
    dpr: number,
    fovFactor: number,
    bounds: any,
  ) {
    const from = nodeMap.get(conn.fromId);
    const to = nodeMap.get(conn.toId);
    if (!from || !to) return null;

    // Frustum Culling
    if (bounds) {
      const m = 5;
      const o1 =
        from.position.x < bounds.x - m ||
        from.position.x > bounds.x + bounds.width + m ||
        from.position.y < bounds.y - m ||
        from.position.y > bounds.y + bounds.height + m;
      const o2 =
        to.position.x < bounds.x - m ||
        to.position.x > bounds.x + bounds.width + m ||
        to.position.y < bounds.y - m ||
        to.position.y > bounds.y + bounds.height + m;
      if (o1 && o2) return null;
    }

    const h = -0.05;
    let rawPath = conn.path ? [...conn.path] : [from.position, to.position];
    if (!conn.path && from.position.x !== to.position.x && from.position.y !== to.position.y) {
      rawPath = [from.position, { x: to.position.x, y: from.position.y }, to.position];
    }
    if (rawPath.length < 2) return null;

    const points3D = rawPath.map((p) => ({ ...p }));
    const arrowLen = 0.35;
    const baseOffset = 0.45;

    const dx0 = points3D[1].x - points3D[0].x;
    const dy0 = points3D[1].y - points3D[0].y;
    const dist0 = Math.hypot(dx0, dy0);

    const dir = conn.direction || 'forward';
    const hasS = conn.directed && (dir === 'reverse' || dir === 'bi');
    const hasE = conn.directed && (dir === 'forward' || dir === 'bi');

    if (dist0 > 0) {
      const offS = baseOffset + (hasS ? arrowLen : 0);
      points3D[0] = {
        x: rawPath[0].x + (dx0 / dist0) * offS,
        y: rawPath[0].y + (dy0 / dist0) * offS,
      };
    }

    let aP = '',
      aPS = '';
    const last = points3D.length - 1;
    const dxE = points3D[last].x - points3D[last - 1].x;
    const dyE = points3D[last].y - points3D[last - 1].y;
    const distE = Math.hypot(dxE, dyE);

    if (distE > 0) {
      const offE = baseOffset + (hasE ? arrowLen : 0);
      points3D[last] = {
        x: rawPath[rawPath.length - 1].x - (dxE / distE) * offE,
        y: rawPath[rawPath.length - 1].y - (dyE / distE) * offE,
      };
      if (hasE) {
        const tip = {
          x: rawPath[rawPath.length - 1].x - (dxE / distE) * baseOffset,
          y: rawPath[rawPath.length - 1].y - (dyE / distE) * baseOffset,
        };
        const res = this.calculateIsometricArrow(tip, points3D[last - 1], h);
        if (res) aP = res;
      }
    }

    if (hasS && dist0 > 0) {
      const tip = {
        x: rawPath[0].x + (dx0 / dist0) * baseOffset,
        y: rawPath[0].y + (dy0 / dist0) * baseOffset,
      };
      const res = this.calculateIsometricArrow(tip, points3D[1], h);
      if (res) aPS = res;
    }

    const projected = points3D
      .map((p) => {
        const sp = this.engine.worldToScreenCached(p.x, h, p.y);
        return sp ? { x: sp.x / dpr, y: sp.y / dpr } : null;
      })
      .filter((p): p is { x: number; y: number } => p !== null);

    if (projected.length < 2) return null;

    const fZ = this.engine.worldToScreenCached(rawPath[0].x, h, rawPath[0].y)?.z || 10;
    const lZ =
      this.engine.worldToScreenCached(
        rawPath[rawPath.length - 1].x,
        h,
        rawPath[rawPath.length - 1].y,
      )?.z || 10;
    const scale = (3.5 * fovFactor) / ((fZ + lZ) / 2);

    let pathData = '';
    if (conn.style === 'rounded' && projected.length > 2) {
      pathData = this.getRoundedOrthogonalPath(projected);
    } else {
      pathData = `M ${projected.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    }

    return {
      ...conn,
      points: projected.map((p) => `${p.x},${p.y}`).join(' '),
      pathData,
      arrowPoints: aP,
      arrowPointsStart: aPS,
      scale: !isNaN(scale) ? scale : 1,
      firstPoint: projected[0],
      lastPoint: projected[projected.length - 1],
    };
  }

  // Computed signal for nodes with screen positions
  positionedNodes = computed(() => {
    this.frameCounter(); // Reactive dependency
    if (!this.engine || !this.engine.initialized) return [];

    const quality = this.engine.frameController.getQualitySettings();
    const activeNodes = this.getPrioritizedActiveNodes(quality.maxVisibleNodes);

    const dpr = window.devicePixelRatio || 1;
    const fovRad = (this.engine.camera.zoom * Math.PI) / 180;
    const fovFactor = 1.0 / Math.tan(fovRad / 2);

    return activeNodes
      .map((node) => this.projectNode(node, dpr, fovFactor, quality))
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .sort((a, b) => b.z - a.z); // Sort back to front
  });

  private getPrioritizedActiveNodes(maxNodes: number): FossFlowNode[] {
    let activeNodes = this.gridService.activeNodes();

    if (activeNodes.length > maxNodes) {
      const centerX = this.engine.camera.target.x;
      const centerZ = this.engine.camera.target.z;

      // Sort by distance to camera target and take closest
      activeNodes = [...activeNodes]
        .map((n) => ({
          node: n,
          dist: Math.hypot(n.position.x - centerX, n.position.y - centerZ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, maxNodes)
        .map((item) => item.node);
    }
    return activeNodes;
  }

  private projectNode(node: FossFlowNode, dpr: number, fovFactor: number, quality: any) {
    const screenPos = this.engine.worldToScreenCached(node.position.x, -0.1, node.position.y);
    if (!screenPos) return null;

    const scale = (3.6 * fovFactor) / screenPos.z;

    // Adaptive LOD
    let lod: 'low' | 'medium' | 'high' = 'high';
    if (scale < quality.lodMediumThreshold) lod = 'low';
    else if (scale < quality.lodHighThreshold) lod = 'medium';

    return {
      ...node,
      screenX: screenPos.x / dpr,
      screenY: screenPos.y / dpr,
      z: screenPos.z,
      scale: scale,
      zIndex: 1000 - Math.floor(screenPos.z * 10),
      lod,
    };
  }

  // Computed signal for paint preview rectangle
  paintPreviewNodes = computed(() => {
    const start = this.dragStartPoint();
    const end = this.dragEndPoint();
    if (!start || !end || !isPlatformBrowser(this.platformId) || !this.engine?.initialized)
      return [];

    const nodes = [];
    const dpr = window.devicePixelRatio || 1;
    const fov = this.getFovFactor();

    for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x++) {
      for (let z = Math.min(start.z, end.z); z <= Math.max(start.z, end.z); z++) {
        const p = this.projectPreviewTile(x, z, dpr, fov);
        if (p) nodes.push(p);
      }
    }
    return nodes.sort((a, b) => b.z - a.z);
  });

  // Preview for Selection Rectangle
  selectionPreviewNodes = computed(() => {
    if (this.editorMode() !== 'select' || !this.dragStartPoint() || !this.dragEndPoint()) return [];

    const start = this.dragStartPoint()!;
    const end = this.dragEndPoint()!;
    const nodes = [];
    const dpr = window.devicePixelRatio || 1;
    const fov = this.getFovFactor();

    for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x++) {
      for (let z = Math.min(start.z, end.z); z <= Math.max(start.z, end.z); z++) {
        const p = this.projectPreviewTile(x, z, dpr, fov);
        if (p) nodes.push(p);
      }
    }
    return nodes.sort((a, b) => b.z - a.z);
  });

  private projectPreviewTile(x: number, z: number, dpr: number, fovFactor: number) {
    const sp = this.engine.worldToScreen(x, -0.1, z);
    if (!sp) return null;
    const scale = (3.6 * fovFactor) / sp.z;
    return {
      x: sp.x / dpr,
      y: sp.y / dpr,
      z: sp.z,
      scale,
      zIndex: 1000 - Math.floor(sp.z * 10) + 1,
    };
  }

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
  private performPaintAt(clientX: number, clientY: number): FossFlowNode | null {
    const hit = this.getHitFromMouse(clientX, clientY);
    if (!hit) return null;

    const gx = Math.round(hit.x);
    const gz = Math.round(hit.z);

    if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
      const changed = this.gridService.paintNode(gx, gz, {
        objectEnabled: this.paintObjectEnabled(),
        floorEnabled: this.paintFloorEnabled(),
        shape: this.brushShape(),
        objectColor: this.brushObjectColor(),
        floorColor: this.brushFloorColor(),
      });

      if (changed) {
        this.pushState();
      }
    }
    return this.gridService.getNodeAt(gx, gz) || null;
  }

  onClick(event: MouseEvent) {
    if (this.showClearConfirm()) return;
    if (this.editorMode() === 'pan') return;

    const duration = Date.now() - this.mouseDownTime;
    if (duration > 250) return;

    const hit = this.getHitFromMouse(event.clientX, event.clientY);
    if (!hit) {
      if (this.editorMode() === 'select') {
        this.selectionService.selectNode(null);
      }
      return;
    }

    const gx = Math.round(hit.x);
    const gz = Math.round(hit.z);
    const node = this.gridService.getNodeAt(gx, gz);

    if (this.editorMode() === 'select') {
      const isMulti = event.ctrlKey || event.metaKey || event.shiftKey;
      this.selectionService.selectNode(node?.id || null, isMulti);
    } else if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
      if (this.paintTool() === 'brush') {
        this.performPaintAt(event.clientX, event.clientY);
      }
    } else if (this.editorMode() === 'connect') {
      this.handleConnectClick(gx, gz, node || null);
    }
  }

  private handleConnectClick(gx: number, gz: number, targetNode: FossFlowNode | null) {
    if (this.activePath().length === 0) {
      // --- STARTING A CONNECTION ---
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
      // Finish directly if it's an active node (has an object)
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

      if (newPoint.x !== lastPoint.x || newPoint.y !== lastPoint.y) {
        this.activePath.update((p) => [...p, newPoint]);
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
    if (!this.engine) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // 1. Drag Logic
    if (this.isDragging) {
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

      const hit = this.getHitFromMouse(event.clientX, event.clientY);
      if (hit) {
        const hx = Math.round(hit.x);
        const hz = Math.round(hit.z);

        if (this.editorMode() === 'paint' || this.editorMode() === 'paint-floor') {
          if (this.paintTool() === 'brush') {
            this.performPaintAt(event.clientX, event.clientY);
          } else {
            this.dragEndPoint.set({ x: hx, z: hz });
          }
        } else if (this.editorMode() === 'select') {
          this.dragEndPoint.set({ x: hx, z: hz });
        }
      }
    }

    // 2. Hover & Preview Logic
    this.updateHoverAndPreview(event);
  }

  private updateHoverAndPreview(event: MouseEvent) {
    const isInteractionMode =
      this.editorMode() === 'connect' ||
      this.editorMode() === 'select' ||
      this.editorMode() === 'paint' ||
      this.editorMode() === 'paint-floor';

    if (!isInteractionMode || (this.isDragging && this.editorMode() === 'pan')) {
      this.previewPoint.set(null);
      this.hoveredNodeId.set(null);
      return;
    }

    const hit = this.getHitFromMouse(event.clientX, event.clientY);
    if (!hit) {
      this.previewPoint.set(null);
      this.hoveredNodeId.set(null);
      return;
    }

    const gx = Math.round(hit.x);
    const gz = Math.round(hit.z);
    const node = this.gridService.getNodeAt(gx, gz);

    this.hoveredNodeId.set(node?.id || null);

    if (this.editorMode() === 'connect') {
      const connUnderMouse = this.connectionService.getConnectionAt(
        gx,
        gz,
        this.gridService.connections(),
        this.gridService.nodes(),
      );

      if (node) {
        this.previewPoint.set({ x: node.position.x, y: node.position.y });
      } else if (connUnderMouse) {
        this.previewPoint.set({ x: gx, y: gz });
      } else {
        this.previewPoint.set({ x: hit.x, y: hit.z });
      }
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

    // Optimized bounds query using GridService spatial partitioning (Quadtree)
    const bounds = { x: minX, y: minZ, width: maxX - minX, height: maxZ - minZ };
    const nodesInBounds = this.gridService.getNodesInBounds(bounds);

    let selectedIds: string[] = [];
    if (this.isAdditiveSelection) {
      selectedIds = [...this.selectionService.selectedNodeIds()];
    }

    for (const node of nodesInBounds) {
      if (!selectedIds.includes(node.id)) {
        selectedIds.push(node.id);
      }
    }

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

    const settings = {
      objectEnabled: this.paintObjectEnabled(),
      floorEnabled: this.paintFloorEnabled(),
      shape: this.brushShape(),
      objectColor: this.brushObjectColor(),
      floorColor: this.brushFloorColor(),
    };

    let batchChanged = false;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        // We use paintNode for single consistency, but GridService could have a batchPaint
        // For simplicity and to avoid spaghetti here, we just use the service logic
        const changed = this.gridService.paintNode(x, z, settings);
        if (changed) batchChanged = true;
      }
    }

    if (batchChanged) {
      this.pushState();
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
    this.updateNodeOrSelection(node.id, { shape3D: svgName, active: !!svgName });
  }

  removeObject(node: any) {
    this.updateNodeOrSelection(node.id, { active: false });
  }

  onFloorColorInput(event: Event, node: any) {
    const input = event.target as HTMLInputElement;
    this.updateNodeOrSelection(node.id, { floorColor: input.value });
  }

  onObjectColorInput(event: Event, node: any) {
    const input = event.target as HTMLInputElement;
    this.updateNodeOrSelection(node.id, { color: input.value });
  }

  applyRecentColorToFloor(color: string, node: any) {
    this.updateNodeOrSelection(node.id, { floorColor: color });
  }

  applyRecentColorToObject(color: string, node: any) {
    this.updateNodeOrSelection(node.id, { color: color });
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

    // Update the singular selectedNode signal for immediate UI feedback in the sidebar
    const current = this.selectedNode();
    if (current && selectedIds.includes(current.id)) {
      this.selectedNode.set({ ...current, ...changes });
    }
  }

  private updateNodeOrSelection(id: string, updates: Partial<FossFlowNode>) {
    const selectedIds = this.selectionService.selectedNodeIds();
    if (selectedIds.includes(id)) {
      this.updateSelectedNodes(updates);
    } else {
      this.updateNode(id, updates);
    }
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
    const pts = this.positionedActivePathPoints();
    const preview = this.previewPoint();
    if (pts.length === 0 && !preview) return '';

    const dpr = window.devicePixelRatio || 1;
    let allPoints = [...pts];

    if (this.activePath().length > 0 && preview && this.engine.initialized) {
      const sp = this.engine.worldToScreen(preview.x, -0.05, preview.y);
      if (sp) allPoints.push({ x: sp.x / dpr, y: sp.y / dpr });
    }

    if (allPoints.length < 2) return '';

    return this.connectionStyle() === 'rounded'
      ? this.getRoundedOrthogonalPath(allPoints)
      : `M ${allPoints.map((p) => `${p.x},${p.y}`).join(' L ')}`;
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
