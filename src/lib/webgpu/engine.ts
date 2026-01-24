/// <reference types="@webgpu/types" />

import { Mat4 } from './math-utils';
import { Camera } from './camera';
import { Node } from '../models/fossflow.types';
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
  private gridPipeline!: GPURenderPipeline; // Pipeline for infinite grid
  private floorVertexBuffer!: GPUBuffer;
  private gridVertexBuffer!: GPUBuffer; // Buffer for the huge quad
  private floorInstanceBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private uniformBindGroup!: GPUBindGroup;
  private gridBindGroup!: GPUBindGroup; // Bind group for infinite grid pipeline

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
    node: Node;
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
    await this.setupGridPipeline();
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
        // Ultra-sharp edges: multiplier reduced to 0.5 for maximum definition
        let edge = clamp(max(fw.x, fw.y) * 0.5, 0.0005, 0.02);
        
        let size = 0.485;
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
        alphaToCoverageEnabled: this.sampleCount > 1,
      },
    });
  }

  private async setupGridPipeline() {
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
        out.clip_pos = uniforms.viewProjectionMatrix * vec4<f32>(pos, 1.0);
        out.world_pos = pos;
        return out;
      }

      @fragment
      fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
        let x = in.world_pos.x;
        let z = in.world_pos.z;
        let fw = fwidth(in.world_pos.xz);
        let pixelSize = max(fw.x, fw.y);

        // Grid Colors
        let bgColor = vec4<f32>(0.898, 0.918, 0.945, 1.0);
        let tileColor = vec4<f32>(1.0, 1.0, 1.0, 1.0);
        
        // Level 0: 1x1 Units
        let p0 = fract(vec2<f32>(x + 0.5, z + 0.5)) - 0.5;
        let edge0 = pixelSize * 1.5 + 0.001;
        let mask0 = 1.0 - smoothstep(-edge0, edge0, max(abs(p0.x), abs(p0.y)) - 0.485);
        let fade0 = 1.0 - smoothstep(0.1, 0.4, pixelSize);

        // Level 1: 10x10 Units
        let p1 = fract(vec2<f32>(x / 10.0 + 0.5, z / 10.0 + 0.5)) - 0.5;
        let edge1 = (pixelSize / 10.0) * 1.5 + 0.001;
        let mask1 = 1.0 - smoothstep(-edge1, edge1, max(abs(p1.x), abs(p1.y)) - 0.495);
        let fade1 = (1.0 - smoothstep(1.0, 4.0, pixelSize)) * (smoothstep(0.1, 0.4, pixelSize));

        // Level 2: 100x100 Units
        let p2 = fract(vec2<f32>(x / 100.0 + 0.5, z / 100.0 + 0.5)) - 0.5;
        let edge2 = (pixelSize / 100.0) * 1.5 + 0.001;
        let mask2 = 1.0 - smoothstep(-edge2, edge2, max(abs(p2.x), abs(p2.y)) - 0.498);
        let fade2 = (1.0 - smoothstep(10.0, 40.0, pixelSize)) * (smoothstep(1.0, 4.0, pixelSize));

        let finalMask = clamp(mask0 * fade0 + mask1 * fade1 + mask2 * fade2, 0.0, 1.0);
        return mix(bgColor, tileColor, finalMask);
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
    const y = 0.0;
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

      if (this.sampleCount > 1) {
        this.multisampledTexture = this.device.createTexture({
          size: [width, height],
          format: this.format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          sampleCount: this.sampleCount,
        });
      } else {
        this.multisampledTexture = null;
      }
    }
  }

  private generateNodesDataHash(nodes: Node[], selectedId: string | null, bounds: any): string {
    const boundsPart = bounds
      ? `${Math.floor(bounds.x)},${Math.floor(bounds.y)},${nodes.length}`
      : 'all';

    let propSum = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.floorColor) {
        propSum =
          (propSum +
            n.floorColor.charCodeAt(1) +
            n.floorColor.charCodeAt(3) +
            n.floorColor.charCodeAt(5)) |
          0;
      }
      propSum = (propSum + (n.active ? 1 : 0)) | 0;
    }

    return `v11_${selectedId || ''}_${boundsPart}_${propSum}`;
  }

  private generateFloorInstances(nodes: Node[], selectedId: string | null): Float32Array {
    const count = nodes.length;

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

    return this.cachedInstanceData.subarray(0, offset);
  }

  render(nodes: Node[], selectedId: string | null): boolean {
    if (!this.device || !this.pipeline || !this.gridPipeline || !this.initialized) return false;

    this.frameController.recordFrame();
    const quality = this.frameController.getQualitySettings();

    if (quality.msaaSamples !== this.sampleCount) {
      this.sampleCount = quality.msaaSamples;

      if (this.depthTexture) this.depthTexture.destroy();
      if (this.multisampledTexture) this.multisampledTexture.destroy();
      this.depthTexture = null;
      this.multisampledTexture = null;

      this.setupPipeline();
      this.setupGridPipeline();
      this.createBuffers();
      this.lastNodesDataHash = '';
    }

    this.updateTextures();

    let bounds = this.getVisibleBounds();
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

    const limitedNodes =
      visibleNodes.length > this.maxInstances
        ? visibleNodes.slice(0, this.maxInstances)
        : visibleNodes;
    const currentHash = this.generateNodesDataHash(limitedNodes, selectedId, bounds);
    let instanceCount = this.lastRenderStats.instanceCount;

    if (currentHash !== this.lastNodesDataHash) {
      this.lastNodesDataHash = currentHash;
      const instanceData = this.generateFloorInstances(limitedNodes, selectedId);
      this.device.queue.writeBuffer(
        this.floorInstanceBuffer,
        0,
        instanceData.buffer,
        instanceData.byteOffset,
        instanceData.byteLength,
      );
      instanceCount = instanceData.length / 8;
      this.lastRenderStats.instanceCount = instanceCount;
      this.lastRenderStats.visibleNodes = limitedNodes.length;
      this.lastRenderStats.culledNodes = nodes.length - limitedNodes.length;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const colorAttachment: GPURenderPassColorAttachment = {
      view:
        this.sampleCount > 1
          ? this.multisampledTexture!.createView()
          : this.context.getCurrentTexture().createView(),
      clearValue: this.CLEAR_COLOR,
      loadOp: 'clear',
      storeOp: this.sampleCount > 1 ? 'discard' : 'store',
    };

    if (this.sampleCount > 1) {
      colorAttachment.resolveTarget = this.context.getCurrentTexture().createView();
    }

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [colorAttachment],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    passEncoder.setPipeline(this.gridPipeline);
    passEncoder.setBindGroup(0, this.gridBindGroup);
    passEncoder.setVertexBuffer(0, this.gridVertexBuffer);
    passEncoder.draw(6, 1);

    if (instanceCount > 0) {
      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, this.uniformBindGroup);
      passEncoder.setVertexBuffer(0, this.floorVertexBuffer);
      passEncoder.setVertexBuffer(1, this.floorInstanceBuffer);
      passEncoder.draw(6, instanceCount);
    }

    passEncoder.end();
    this.device.queue.submit([commandEncoder.finish()]);

    return true;
  }

  getFps(): number {
    return this.frameController.getFps();
  }

  getQualityLevel(): string {
    return this.frameController.getQualityLevel();
  }

  getRenderStats() {
    return { ...this.lastRenderStats };
  }

  clearProjectionCache(): void {
    this.projectionCache.clear();
    this.lastRenderStats.cachedProjections = 0;
  }

  setQualityLevel(level: 'ultra' | 'high' | 'medium' | 'low' | 'potato'): void {
    this.frameController.forceQualityLevel(level);
  }

  private updateCameraStateHash(): string {
    const vp = this.camera.getViewProjectionMatrix();
    return `${vp[0].toFixed(8)}_${vp[5].toFixed(8)}_${vp[12].toFixed(5)}_${vp[15].toFixed(5)}`;
  }

  worldToScreenCached(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): { x: number; y: number; z: number } | null {
    const currentHash = this.updateCameraStateHash();
    if (currentHash !== this.cameraStateHash) {
      this.cameraStateHash = currentHash;
      this.projectionCache.clear();
      this.lastRenderStats.cachedProjections = 0;
    }

    const key = `${worldX.toFixed(2)}_${worldY.toFixed(2)}_${worldZ.toFixed(2)}`;
    const cached = this.projectionCache.get(key);
    if (cached !== undefined) {
      this.lastRenderStats.cachedProjections++;
      return cached;
    }

    const result = this.worldToScreen(worldX, worldY, worldZ);
    this.projectionCache.set(key, result);
    return result;
  }

  worldToScreen(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): { x: number; y: number; z: number } | null {
    const vp = this.camera.getViewProjectionMatrix();
    const clipX = vp[0] * worldX + vp[4] * worldY + vp[8] * worldZ + vp[12];
    const clipY = vp[1] * worldX + vp[5] * worldY + vp[9] * worldZ + vp[13];
    const clipZ = vp[2] * worldX + vp[6] * worldY + vp[10] * worldZ + vp[14];
    const clipW = vp[3] * worldX + vp[7] * worldY + vp[11] * worldZ + vp[15];

    if (clipW === 0 || clipZ < 0) return null;
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) return null;
    if (!this.context) return null;

    const width = this.context.canvas.width;
    const height = this.context.canvas.height;
    return { x: (ndcX + 1) * 0.5 * width, y: (1 - ndcY) * 0.5 * height, z: clipW };
  }

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
  }
}
