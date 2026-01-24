/// <reference types="@webgpu/types" />

import { Mat4 } from './math-utils';
import { Camera } from './camera';
import { FossFlowNode } from '../models/fossflow.types';
import {
  AdaptiveFrameController,
  QualitySettings,
  QUALITY_PRESETS,
  SpatialHash,
  LRUCache,
} from '../utils/optimizer';

/**
 * WebGPU Engine - Floor Only
 * Objects are rendered as HTML/SVG overlays
 */
export class WebGPUEngine {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  private pipeline!: GPURenderPipeline;
  private gridPipeline!: GPURenderPipeline; // New pipeline for infinite grid
  private floorVertexBuffer!: GPUBuffer;
  private gridVertexBuffer!: GPUBuffer; // Buffer for the huge quad
  private floorInstanceBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private uniformBindGroup!: GPUBindGroup;
  private gridBindGroup!: GPUBindGroup; // Bind group for grid pipeline

  private floorInstanceData!: Float32Array;

  private depthTexture: GPUTexture | null = null;
  private multisampledTexture: GPUTexture | null = null;
  private sampleCount = 4;

  public camera = new Camera();
  public initialized = false;
  private readonly maxInstances = 100000;

  // Hysteresis for culling stability
  private lastStableBounds: { x: number; y: number; width: number; height: number } | null = null;
  private readonly CULLING_HYSTERESIS = 15.0;

  private readonly CLEAR_COLOR = { r: 0xe5 / 255, g: 0xea / 255, b: 0xf1 / 255, a: 1.0 };

  // ==================== ADVANCED OPTIMIZATION ====================
  // Adaptive Frame Rate Controller
  public readonly frameController = new AdaptiveFrameController(60);

  // Spatial Hash for O(1) neighbor queries (faster than Quadtree for uniform grids)
  private readonly spatialHash = new SpatialHash<{
    x: number;
    y: number;
    id: string;
    node: FossFlowNode;
  }>(5);

  // LRU Cache for projection calculations
  private readonly projectionCache = new LRUCache<
    string,
    { x: number; y: number; z: number } | null
  >(5000);
  private cameraStateHash = '';

  // Render statistics
  private lastRenderStats = {
    instanceCount: 0,
    visibleNodes: 0,
    cachedProjections: 0,
    culledNodes: 0,
  };

  // Dynamic MSAA based on performance
  private dynamicSampleCount = 4;
  private needsPipelineRebuild = false;

  // Dirty tracking for GPU buffer optimization
  private lastNodesDataHash = '';
  private cachedInstanceData: Float32Array | null = null;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    console.log('[WebGPUEngine] init starting...');
    if (!navigator.gpu) {
      console.error('[WebGPUEngine] navigator.gpu is undefined');
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.error('[WebGPUEngine] Failed to request adapter');
      return false;
    }
    this.device = await adapter.requestDevice();
    console.log('[WebGPUEngine] Device requested');
    this.context = canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
    console.log('[WebGPUEngine] Context configured');

    await this.setupPipeline();
    this.setupGridPipeline();
    this.createGeometries();
    this.createBuffers();

    this.initialized = true;
    console.log('[WebGPUEngine] Initialization complete');
    return true;
  }

  private async setupPipeline() {
    const shaderCode = `
      struct Uniforms {
        viewProjectionMatrix: mat4x4<f32>,
      };

      struct InstanceInput {
        @location(1) pos_and_selection: vec4<f32>, // x, y, z, selection_flag
        @location(2) color: vec4<f32>,
      };

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      struct VertexOutput {
        @builtin(position) clip_pos: vec4<f32>,
        @location(0) world_pos: vec3<f32>,
        @location(1) color: vec4<f32>,
        @location(2) @interpolate(flat) is_selected: f32,
      };

      @vertex
      fn vs_main(
        @location(0) pos: vec3<f32>,
        @location(1) inst_pos: vec4<f32>,
        @location(2) inst_color: vec4<f32>,
      ) -> VertexOutput {
        var out: VertexOutput;
        let world_pos = pos + inst_pos.xyz;
        out.clip_pos = uniforms.viewProjectionMatrix * vec4<f32>(world_pos, 1.0);
        out.world_pos = world_pos;
        out.color = inst_color;
        out.is_selected = inst_pos.w;
        return out;
      }

      @fragment
      fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
        let x = in.world_pos.x;
        let z = in.world_pos.z;
        let p = abs(vec2<f32>(fract(x + 0.5) - 0.5, fract(z + 0.5) - 0.5));
        
        let fw = fwidth(in.world_pos.xz);
        // Clamp edge to prevent shimmering during fast camera movements
        let edge = clamp(max(fw.x, fw.y) * 2.0, 0.005, 0.05);
        
        let size = 0.48;
        let dist = max(p.x, p.y) - size;
        
        let is_inside = 1.0 - smoothstep(-edge, edge, dist);
        
        if (is_inside <= 0.0) {
            discard;
        }
        
        var finalColor = vec4<f32>(in.color.rgb, in.color.a * is_inside);
        
        // Selection Highlight
        if (in.is_selected > 0.5) {
          let border_dist = max(p.x, p.y) - 0.46;
          let is_border = (1.0 - smoothstep(-edge, edge, border_dist)) * is_inside;
          let selectionColor = vec4<f32>(0.23, 0.51, 0.96, 1.0);
          finalColor = mix(finalColor, selectionColor, is_border * 0.9);
        }

        return finalColor;
      }
    `;

    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          // Basic unit quad (tile)
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
          // Instance data
          {
            arrayStride: 32, // pos(3) + selection(1) + color(4) = 8 floats * 4 bytes
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x4' }, // inst_pos (includes selection in w)
              { shaderLocation: 2, offset: 16, format: 'float32x4' }, // inst_color
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
        // Favor tiles over the grid plane at the same Y
        depthBias: -100,
        depthBiasSlopeScale: -1.0,
      },
      multisample: {
        count: this.sampleCount,
        alphaToCoverageEnabled: true,
      },
    });
  }

  private setupGridPipeline() {
    const shaderCode = `
      struct Uniforms {
        viewProjectionMatrix: mat4x4<f32>,
      };

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      struct VertexOutput {
        @builtin(position) clip_pos: vec4<f32>,
        @location(0) world_pos: vec3<f32>,
      };

      @vertex
      fn vs_main(
        @location(0) pos: vec3<f32>
      ) -> VertexOutput {
        var out: VertexOutput;
        // Pos is already world position for the huge quad
        out.clip_pos = uniforms.viewProjectionMatrix * vec4<f32>(pos, 1.0);
        out.world_pos = pos;
        return out;
      }

      @fragment
      fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
        let x = in.world_pos.x;
        let z = in.world_pos.z;
        
        // Local coordinates within the 1x1 tile [-0.5, 0.5]
        let p = fract(vec2<f32>(x + 0.5, z + 0.5)) - 0.5;
        
        // Analytical Anti-Aliasing
        let fw = fwidth(in.world_pos.xz);
        let edge = max(fw.x, fw.y) * 1.5 + 0.001; 
        
        // Define the white tile area
        let size = 0.485;
        let distArr = abs(p) - size;
        let dist = max(distArr.x, distArr.y);
        
        // Smooth mask
        let mask = 1.0 - smoothstep(-edge, edge, dist);
        
        // Colors
        let bgColor = vec4<f32>(0.898, 0.918, 0.945, 1.0); // Space Grey
        let tileColor = vec4<f32>(1.0, 1.0, 1.0, 1.0);     // White
        
        // Fade out grid lines at extreme distance to avoid Moire/noise
        let pixelSize = max(fw.x, fw.y);
        let gridFade = 1.0 - smoothstep(0.12, 0.45, pixelSize);
        
        // At a distance, the grid should dissolve into the background color smoothly
        return mix(bgColor, tileColor, mask * gridFade);
      }
    `;

    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.gridPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        format: 'depth24plus',
      },
      multisample: { count: this.sampleCount },
    });
  }

  private createGeometries() {
    const s = 0.5;
    const floorData = new Float32Array([
      // Triangle 1
      -s,
      0,
      -s,
      s,
      0,
      -s,
      -s,
      0,
      s,
      // Triangle 2
      s,
      0,
      -s,
      s,
      0,
      s,
      -s,
      0,
      s,
    ]);
    this.floorVertexBuffer = this.createBuffer(floorData, GPUBufferUsage.VERTEX);
  }

  private createBuffer(data: Float32Array, usage: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data.buffer);
    return buffer;
  }

  private createBuffers() {
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformBindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    // Create Grid Buffer (Huge Quad)
    const s = 10000.0;
    const y = 0.0; // Perfect alignment with clicking plane
    const gridData = new Float32Array([-s, y, -s, s, y, -s, -s, y, s, -s, y, s, s, y, -s, s, y, s]);
    this.gridVertexBuffer = this.createBuffer(gridData, GPUBufferUsage.VERTEX);

    // Create Grid Bind Group
    this.gridBindGroup = this.device.createBindGroup({
      layout: this.gridPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.floorInstanceData = new Float32Array(this.maxInstances * 8);

    this.floorInstanceBuffer = this.device.createBuffer({
      size: this.maxInstances * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  updateCamera(aspect: number) {
    this.camera.aspect = aspect;
    const vp = this.camera.getViewProjectionMatrix();
    this.device.queue.writeBuffer(this.uniformBuffer, 0, vp.buffer);
  }

  private updateTextures() {
    if (!this.context) return;
    const width = Math.floor(this.context.canvas.width);
    const height = Math.floor(this.context.canvas.height);
    if (
      !this.depthTexture ||
      Math.abs(this.depthTexture.width - width) > 1 ||
      Math.abs(this.depthTexture.height - height) > 1
    ) {
      if (this.depthTexture) this.depthTexture.destroy();
      if (this.multisampledTexture) this.multisampledTexture.destroy();
      this.depthTexture = this.device.createTexture({
        size: [width, height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: this.sampleCount,
      });
      this.multisampledTexture = this.device.createTexture({
        size: [width, height],
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: this.sampleCount,
      });
    }
  }

  private generateNodesDataHash(
    nodes: FossFlowNode[],
    selectedId: string | null,
    bounds: any,
  ): string {
    // We MUST include bounds in the hash because they determine which nodes are in 'nodes' array.
    // If we move the camera and the culling set changes, the hash MUST change.
    const boundsPart = bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : 'all';

    const sampleSize = Math.min(nodes.length, 5000);
    let hash = `v7_${nodes.length}_${selectedId || ''}_${boundsPart}`;

    for (let i = 0; i < sampleSize; i += 2) {
      // Sample every 2 nodes for performance if many
      const n = nodes[i];
      hash += `|${n.id.slice(-3)}@${n.position.x},${n.position.y}:${n.floorColor || ''}`;
    }
    return hash;
  }

  private generateFloorInstances(nodes: FossFlowNode[], selectedId: string | null): Float32Array {
    const count = nodes.length;

    // Reuse or create the persistent Float32Array
    if (!this.cachedInstanceData || this.cachedInstanceData.length !== this.maxInstances * 8) {
      this.cachedInstanceData = new Float32Array(this.maxInstances * 8);
    }

    let offset = 0;
    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      const hasFloor = n.floorColor && n.floorColor.toLowerCase() !== '#ffffff';

      if (n.active || hasFloor) {
        const isSelected = n.id === selectedId;
        const color = n.floorColor ? this.parseHexColor(n.floorColor) : [1.0, 1.0, 1.0, 1.0];

        // Note: y is 0 for tiles. n.position.y is Z in 3D world.
        this.cachedInstanceData[offset++] = n.position.x;
        this.cachedInstanceData[offset++] = 0;
        this.cachedInstanceData[offset++] = n.position.y;
        this.cachedInstanceData[offset++] = isSelected ? 1.0 : 0.0;
        this.cachedInstanceData[offset++] = color[0];
        this.cachedInstanceData[offset++] = color[1];
        this.cachedInstanceData[offset++] = color[2];
        this.cachedInstanceData[offset++] = color[3];
      }

      if (offset / 8 >= this.maxInstances) break;
    }

    // Return a view of the reused buffer to avoid copies
    return this.cachedInstanceData.subarray(0, offset);
  }

  render(nodes: FossFlowNode[], selectedId: string | null): boolean {
    if (!this.device || !this.pipeline || !this.gridPipeline || !this.initialized) return false;

    // ==================== PERFORMANCE MONITORING ====================
    this.frameController.recordFrame();

    // Note: We avoid skipping frames (shouldRenderFrame) in the editor
    // to prevent blank-frame flickering in WebGPU.
    // Quality settings are still used for MSAA and other optimizations.

    // Get current quality settings
    const quality = this.frameController.getQualitySettings();

    // Check if we need to rebuild pipelines for new MSAA level
    if (quality.msaaSamples !== this.dynamicSampleCount) {
      this.dynamicSampleCount = quality.msaaSamples;
      this.needsPipelineRebuild = true;
      // Pipeline rebuild would happen here in a full implementation
      // For now, we just note it for future optimization
    }

    this.updateTextures();

    // ==================== FRUSTUM CULLING (STABLE) ====================
    // Quantize bound logic but keep it reactive to current view
    let rawBounds = this.getVisibleBounds();
    let bounds = rawBounds;
    if (bounds) {
      bounds.x = Math.floor(bounds.x / 10) * 10;
      bounds.y = Math.floor(bounds.y / 10) * 10;
      bounds.width = Math.ceil(bounds.width / 10) * 10 + 20;
      bounds.height = Math.ceil(bounds.height / 10) * 10 + 20;
    }

    const visibleNodes = bounds
      ? nodes.filter((n) => {
          const hasFloor = n.floorColor && n.floorColor.toLowerCase() !== '#ffffff';
          if (!n.active && !hasFloor) return false;

          return (
            n.position.x >= bounds!.x &&
            n.position.x <= bounds!.x + bounds!.width &&
            n.position.y >= bounds!.y &&
            n.position.y <= bounds!.y + bounds!.height
          );
        })
      : nodes.filter((n) => n.active || (n.floorColor && n.floorColor.toLowerCase() !== '#ffffff'));

    const maxNodesGPU = this.maxInstances;
    const limitedNodes =
      visibleNodes.length > maxNodesGPU ? visibleNodes.slice(0, maxNodesGPU) : visibleNodes;

    // DIRTY TRACKING: Only re-upload if nodes data actually changed
    // This saves massive CPU time during camera movements
    const currentHash = this.generateNodesDataHash(limitedNodes, selectedId, bounds);
    let instanceCount = this.lastRenderStats.instanceCount;

    if (currentHash !== this.lastNodesDataHash) {
      this.lastNodesDataHash = currentHash;

      // 1. Generate sparse instances for colored tiles
      const instanceData = this.generateFloorInstances(limitedNodes, selectedId);
      this.device.queue.writeBuffer(
        this.floorInstanceBuffer,
        0,
        instanceData.buffer as any,
        instanceData.byteOffset,
        instanceData.byteLength,
      );
      instanceCount = instanceData.length / 8;

      // Update render stats (only on write)
      this.lastRenderStats.instanceCount = instanceCount;
      this.lastRenderStats.visibleNodes = limitedNodes.length;
      this.lastRenderStats.culledNodes = nodes.length - limitedNodes.length;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.multisampledTexture!.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: this.CLEAR_COLOR,
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    // 2. Draw Infinite Grid (Background)
    passEncoder.setPipeline(this.gridPipeline);
    passEncoder.setBindGroup(0, this.gridBindGroup);
    passEncoder.setVertexBuffer(0, this.gridVertexBuffer);
    passEncoder.draw(6, 1);

    // 3. Draw Sparse Tiles (Foreground)
    if (instanceCount > 0) {
      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, this.uniformBindGroup);
      passEncoder.setVertexBuffer(0, this.floorVertexBuffer);
      passEncoder.setVertexBuffer(1, this.floorInstanceBuffer);
      passEncoder.draw(6, instanceCount);
    }

    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);

    return true; // Frame rendered
  }

  // ==================== PERFORMANCE MONITORING ====================
  /**
   * Get current FPS
   */
  getFps(): number {
    return this.frameController.getFps();
  }

  /**
   * Get quality level string
   */
  getQualityLevel(): string {
    return this.frameController.getQualityLevel();
  }

  /**
   * Get render statistics
   */
  getRenderStats(): typeof this.lastRenderStats {
    return { ...this.lastRenderStats };
  }

  /**
   * Clear the projection cache manually
   */
  clearProjectionCache(): void {
    this.projectionCache.clear();
    this.lastRenderStats.cachedProjections = 0;
  }

  /**
   * Force a specific quality level (user override)
   */
  setQualityLevel(level: 'ultra' | 'high' | 'medium' | 'low' | 'potato'): void {
    this.frameController.forceQualityLevel(level);
  }

  /**
   * Update camera state hash for cache invalidation
   */
  private updateCameraStateHash(): string {
    const vp = this.camera.getViewProjectionMatrix();
    // High precision hash of matrix components that change during tilt/pan/zoom
    // We use more components and higher precision to avoid floating point jitter artifacts
    return `${vp[0].toFixed(8)}_${vp[5].toFixed(8)}_${vp[12].toFixed(5)}_${vp[15].toFixed(5)}`;
  }

  /**
   * Cached world to screen projection
   */
  worldToScreenCached(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): { x: number; y: number; z: number } | null {
    // Check if camera moved - invalidate cache
    const currentHash = this.updateCameraStateHash();
    if (currentHash !== this.cameraStateHash) {
      this.cameraStateHash = currentHash;
      this.projectionCache.clear();
      this.lastRenderStats.cachedProjections = 0;
    }

    // Check cache
    const key = `${worldX.toFixed(2)}_${worldY.toFixed(2)}_${worldZ.toFixed(2)}`;
    const cached = this.projectionCache.get(key);
    if (cached !== undefined) {
      this.lastRenderStats.cachedProjections++;
      return cached;
    }

    // Calculate and cache
    const result = this.worldToScreen(worldX, worldY, worldZ);
    this.projectionCache.set(key, result);
    return result;
  }

  // Method to project 3D world position to 2D screen position
  worldToScreen(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): { x: number; y: number; z: number } | null {
    const vp = this.camera.getViewProjectionMatrix();

    // Transform world position to clip space
    const clipX = vp[0] * worldX + vp[4] * worldY + vp[8] * worldZ + vp[12];
    const clipY = vp[1] * worldX + vp[5] * worldY + vp[9] * worldZ + vp[13];
    const clipZ = vp[2] * worldX + vp[6] * worldY + vp[10] * worldZ + vp[14];
    const clipW = vp[3] * worldX + vp[7] * worldY + vp[11] * worldZ + vp[15];

    if (clipW === 0 || clipZ < 0) return null; // Behind camera

    // Perspective divide
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    // Frustum Culling (Optimization: Task 7 & 2)
    // Check if the point is significantly outside the viewport
    // Using a margin of 1.2 to avoid objects popping in/out at edges
    if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) return null;

    // Convert to screen coordinates
    if (!this.context) return null;
    const width = this.context.canvas.width;
    const height = this.context.canvas.height;

    const screenX = (ndcX + 1) * 0.5 * width;
    const screenY = (1 - ndcY) * 0.5 * height;

    return { x: screenX, y: screenY, z: clipW };
  }

  // Helper for Frustum Culling / Spatial Partitioning
  getVisibleBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.context) return null;
    const width = this.context.canvas.width;
    const height = this.context.canvas.height;

    const corners = [
      this.camera.intersectPlaneXZ(this.camera.getRay(0, 0, width, height)),
      this.camera.intersectPlaneXZ(this.camera.getRay(width, 0, width, height)),
      this.camera.intersectPlaneXZ(this.camera.getRay(0, height, width, height)),
      this.camera.intersectPlaneXZ(this.camera.getRay(width, height, width, height)),
    ].filter((c): c is { x: number; z: number } => c !== null);

    if (corners.length === 0) return null;

    const minX = Math.min(...corners.map((c) => c.x)) - 15;
    const maxX = Math.max(...corners.map((c) => c.x)) + 15;
    const minZ = Math.min(...corners.map((c) => c.z)) - 15;
    const maxZ = Math.max(...corners.map((c) => c.z)) + 15;

    return { x: minX, y: minZ, width: maxX - minX, height: maxZ - minZ };
  }

  private parseHexColor(hex: string): number[] {
    if (!hex || hex.length < 7) return [1, 1, 1, 1];
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, 1.0];
  }

  destroy() {
    this.depthTexture?.destroy();
    this.multisampledTexture?.destroy();
    this.floorVertexBuffer?.destroy();
    this.floorInstanceBuffer?.destroy();
    this.gridVertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    // Device usually doesn't need explicit destroy if we want to reuse it,
    // but since this engine instance is tied to the component, we can let the GC handle the JS object,
    // and just ensure GPU resources are released.
  }
}
