/**
 * Performance Optimizer - Advanced Techniques for Low-End Hardware
 *
 * Implements:
 * 1. Adaptive Frame Rate (Render Budgeting)
 * 2. Object Pooling for DOM elements
 * 3. Throttled computation scheduling
 * 4. Memory-efficient caching
 */

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  cpuLoad: number;
  gpuLoad: number;
  memoryUsage: number;
}

export interface RenderBudget {
  targetFps: number;
  minFps: number;
  maxFrameTime: number;
  currentBudget: number;
}

/**
 * Adaptive Frame Rate Controller
 * Adjusts render frequency based on system performance
 */
export class AdaptiveFrameController {
  private frameTimes: number[] = [];
  private readonly maxSamples = 30;
  private lastFrameTime = 0;
  private frameSkipCounter = 0;
  private qualityLevel: 'ultra' | 'high' | 'medium' | 'low' | 'potato' = 'high';

  // Thresholds in ms (Targeting 60fps as standard)
  private readonly thresholds = {
    ultra: 9, // 110+ FPS (para monitores de 120Hz/144Hz)
    high: 20, // 50+ FPS (permite 60 FPS estables sin degradar)
    medium: 35, // 30+ FPS
    low: 50, // 20+ FPS
    potato: 70, // <15 FPS
  };

  private budget: RenderBudget = {
    targetFps: 60,
    minFps: 20,
    maxFrameTime: 16.67,
    currentBudget: 16.67,
  };

  constructor(targetFps: number = 60) {
    this.budget.targetFps = targetFps;
    this.budget.maxFrameTime = 1000 / targetFps;
    this.budget.currentBudget = this.budget.maxFrameTime;
  }

  /**
   * Record a frame and calculate metrics
   */
  recordFrame(): void {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime;
      this.frameTimes.push(delta);
      if (this.frameTimes.length > this.maxSamples) {
        this.frameTimes.shift();
      }
      this.updateQualityLevel();
    }
    this.lastFrameTime = now;
  }

  /**
   * In WebGPU, skipping a rendering frame is dangerous as it leads to
   * black/blank frames in the swap-chain.
   *
   * DECISION: We always return true for drawing, but heavy system logic
   * should check shouldUpdateHeavyLogic() instead.
   */
  shouldRenderFrame(): boolean {
    return true;
  }

  /**
   * Decide if heavy background logic (like spatial partitioning or pathfinding)
   * should run this frame based on the hardware budget.
   */
  shouldUpdateHeavyLogic(): boolean {
    if (this.qualityLevel === 'ultra' || this.qualityLevel === 'high') {
      return true;
    }

    this.frameSkipCounter++;
    const skipThreshold = this.qualityLevel === 'medium' ? 2 : this.qualityLevel === 'low' ? 3 : 5;

    if (this.frameSkipCounter >= skipThreshold) {
      this.frameSkipCounter = 0;
      return true;
    }
    return false;
  }

  /**
   * Get current quality settings based on performance
   */
  getQualitySettings(): QualitySettings {
    return QUALITY_PRESETS[this.qualityLevel];
  }

  /**
   * Get current FPS
   */
  getFps(): number {
    if (this.frameTimes.length === 0) return 60;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return Math.round(1000 / avg);
  }

  /**
   * Get average frame time in ms
   */
  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 16.67;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  getQualityLevel(): string {
    return this.qualityLevel;
  }

  private lastQualityChangeTime = 0;
  private readonly qualityChangeCooldown = 2000; // 2 seconds minimum between automatic quality changes

  private updateQualityLevel(): void {
    const now = performance.now();
    if (now - this.lastQualityChangeTime < this.qualityChangeCooldown) return;

    const avgFrameTime = this.getAverageFrameTime();

    // Hysteresis to prevent flickering between levels
    const hysteresis = 5; // increased to 5ms for more stability

    let newLevel = this.qualityLevel;
    if (avgFrameTime < this.thresholds.ultra - hysteresis) {
      newLevel = 'ultra';
    } else if (avgFrameTime < this.thresholds.high - hysteresis) {
      newLevel = 'high';
    } else if (avgFrameTime < this.thresholds.medium - hysteresis) {
      newLevel = 'medium';
    } else if (avgFrameTime < this.thresholds.low - hysteresis) {
      newLevel = 'low';
    } else {
      newLevel = 'potato';
    }

    if (newLevel !== this.qualityLevel) {
      this.qualityLevel = newLevel;
      this.lastQualityChangeTime = now;
    }
  }

  /**
   * Force a quality level (useful for user override)
   */
  forceQualityLevel(level: 'ultra' | 'high' | 'medium' | 'low' | 'potato'): void {
    this.qualityLevel = level;
  }
}

/**
 * Quality Settings based on performance level
 */
export interface QualitySettings {
  // LOD thresholds
  lodHighThreshold: number; // Scale above which use high LOD
  lodMediumThreshold: number; // Scale above which use medium LOD

  // Render settings
  maxVisibleNodes: number; // Max nodes to render
  enableShadows: boolean;
  enableAntialiasing: boolean;
  enableAnimations: boolean;

  // GPU settings
  msaaSamples: number; // 1, 2, or 4
  textureQuality: 'high' | 'medium' | 'low';

  // DOM optimization
  useSimplifiedDOM: boolean; // Use simpler DOM structure
  enableCSSTransitions: boolean;

  // Update frequency
  signalUpdateThrottle: number; // ms between signal updates
}

export const QUALITY_PRESETS: Record<string, QualitySettings> = {
  ultra: {
    lodHighThreshold: 0.3,
    lodMediumThreshold: 0.15,
    maxVisibleNodes: 10000,
    enableShadows: true,
    enableAntialiasing: true,
    enableAnimations: true,
    msaaSamples: 4,
    textureQuality: 'high',
    useSimplifiedDOM: false,
    enableCSSTransitions: true,
    signalUpdateThrottle: 0,
  },
  high: {
    lodHighThreshold: 0.4,
    lodMediumThreshold: 0.2,
    maxVisibleNodes: 5000,
    enableShadows: true,
    enableAntialiasing: true,
    enableAnimations: true,
    msaaSamples: 4,
    textureQuality: 'high',
    useSimplifiedDOM: false,
    enableCSSTransitions: true,
    signalUpdateThrottle: 0,
  },
  medium: {
    lodHighThreshold: 0.5,
    lodMediumThreshold: 0.25,
    maxVisibleNodes: 2000,
    enableShadows: false,
    enableAntialiasing: true,
    enableAnimations: true,
    msaaSamples: 4, // Using 4 samples as 2 is often unsupported on some hardware
    textureQuality: 'medium',
    useSimplifiedDOM: false,
    enableCSSTransitions: true,
    signalUpdateThrottle: 16,
  },
  low: {
    lodHighThreshold: 0.6,
    lodMediumThreshold: 0.3,
    maxVisibleNodes: 1000,
    enableShadows: false,
    enableAntialiasing: false,
    enableAnimations: false,
    msaaSamples: 1, // MSAA Off
    textureQuality: 'low',
    useSimplifiedDOM: true,
    enableCSSTransitions: false,
    signalUpdateThrottle: 33,
  },
  potato: {
    lodHighThreshold: 0.8,
    lodMediumThreshold: 0.4,
    maxVisibleNodes: 500,
    enableShadows: false,
    enableAntialiasing: false,
    enableAnimations: false,
    msaaSamples: 1,
    textureQuality: 'low',
    useSimplifiedDOM: true,
    enableCSSTransitions: false,
    signalUpdateThrottle: 50,
  },
};

/**
 * Object Pool for DOM elements
 * Reuses DOM elements instead of creating/destroying them
 */
export class DOMElementPool<T extends HTMLElement> {
  private pool: T[] = [];
  private activeElements: Set<T> = new Set();
  private factory: () => T;
  private reset: (element: T) => void;

  constructor(factory: () => T, reset: (element: T) => void, initialSize: number = 100) {
    this.factory = factory;
    this.reset = reset;

    // Pre-allocate elements
    for (let i = 0; i < initialSize; i++) {
      const el = factory();
      el.style.display = 'none';
      this.pool.push(el);
    }
  }

  /**
   * Get an element from the pool or create a new one
   */
  acquire(): T {
    let element: T;

    if (this.pool.length > 0) {
      element = this.pool.pop()!;
    } else {
      element = this.factory();
    }

    element.style.display = '';
    this.activeElements.add(element);
    return element;
  }

  /**
   * Return an element to the pool
   */
  release(element: T): void {
    if (!this.activeElements.has(element)) return;

    this.reset(element);
    element.style.display = 'none';
    this.activeElements.delete(element);
    this.pool.push(element);
  }

  /**
   * Release all elements back to pool
   */
  releaseAll(): void {
    this.activeElements.forEach((el) => {
      this.reset(el);
      el.style.display = 'none';
      this.pool.push(el);
    });
    this.activeElements.clear();
  }

  /**
   * Get count of active elements
   */
  getActiveCount(): number {
    return this.activeElements.size;
  }

  /**
   * Get count of pooled elements
   */
  getPooledCount(): number {
    return this.pool.length;
  }
}

/**
 * Throttled Computation Scheduler
 * Ensures expensive computations don't block the main thread
 */
export class ComputationScheduler {
  private pendingComputations: Map<string, { fn: () => void; priority: number }> = new Map();
  private isProcessing = false;
  private maxTimePerFrame = 4; // ms - leave room for rendering

  /**
   * Schedule a computation with a given priority (higher = more urgent)
   */
  schedule(id: string, fn: () => void, priority: number = 0): void {
    this.pendingComputations.set(id, { fn, priority });

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Cancel a scheduled computation
   */
  cancel(id: string): void {
    this.pendingComputations.delete(id);
  }

  private processQueue(): void {
    if (this.pendingComputations.size === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const startTime = performance.now();

    // Sort by priority
    const sorted = Array.from(this.pendingComputations.entries()).sort(
      (a, b) => b[1].priority - a[1].priority,
    );

    for (const [id, { fn }] of sorted) {
      if (performance.now() - startTime > this.maxTimePerFrame) {
        // Budget exceeded, continue next frame
        requestAnimationFrame(() => this.processQueue());
        return;
      }

      try {
        fn();
      } catch (e) {
        console.error(`Scheduled computation ${id} failed:`, e);
      }
      this.pendingComputations.delete(id);
    }

    this.isProcessing = false;
  }
}

/**
 * Spatial Hash for O(1) neighbor queries
 * Faster than Quadtree for uniform distributions
 */
export class SpatialHash<T extends { x: number; y: number; id: string }> {
  private buckets: Map<string, T[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number = 10) {
    this.cellSize = cellSize;
  }

  private getKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  clear(): void {
    this.buckets.clear();
  }

  insert(item: T): void {
    const key = this.getKey(item.x, item.y);
    if (!this.buckets.has(key)) {
      this.buckets.set(key, []);
    }
    this.buckets.get(key)!.push(item);
  }

  insertMany(items: T[]): void {
    for (const item of items) {
      this.insert(item);
    }
  }

  /**
   * Query items in a rectangular region
   * Much faster than Quadtree for large datasets
   */
  query(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const results: T[] = [];

    const startCX = Math.floor(minX / this.cellSize);
    const endCX = Math.floor(maxX / this.cellSize);
    const startCY = Math.floor(minY / this.cellSize);
    const endCY = Math.floor(maxY / this.cellSize);

    for (let cx = startCX; cx <= endCX; cx++) {
      for (let cy = startCY; cy <= endCY; cy++) {
        const key = `${cx},${cy}`;
        const bucket = this.buckets.get(key);
        if (bucket) {
          for (const item of bucket) {
            if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
              results.push(item);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Get neighbors within radius (for LOD calculations)
   */
  getNeighbors(x: number, y: number, radius: number): T[] {
    return this.query(x - radius, y - radius, x + radius, y + radius);
  }
}

/**
 * Frame Time Accumulator for smooth updates
 * Accumulates time and releases it in chunks for consistent physics/animation
 */
export class FrameTimeAccumulator {
  private accumulator = 0;
  private readonly fixedTimestep: number;
  private lastTime = 0;

  constructor(fixedTimestep: number = 16.67) {
    this.fixedTimestep = fixedTimestep;
  }

  /**
   * Update and return the number of fixed steps to perform
   */
  update(): number {
    const now = performance.now();
    if (this.lastTime === 0) {
      this.lastTime = now;
      return 0;
    }

    const delta = Math.min(now - this.lastTime, 100); // Cap to prevent spiral of death
    this.lastTime = now;
    this.accumulator += delta;

    let steps = 0;
    while (this.accumulator >= this.fixedTimestep) {
      this.accumulator -= this.fixedTimestep;
      steps++;
    }

    return steps;
  }

  /**
   * Get interpolation alpha for smooth rendering
   */
  getAlpha(): number {
    return this.accumulator / this.fixedTimestep;
  }
}

/**
 * LRU Cache for expensive computations
 */
export class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Debounce utility for signal updates
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle utility for frequent updates
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) {
          fn(...lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  };
}
