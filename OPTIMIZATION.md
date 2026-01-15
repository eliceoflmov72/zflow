# 🚀 Técnicas Avanzadas de Optimización - FossFlow Editor

Este documento detalla las técnicas de optimización implementadas para maximizar el rendimiento del editor en hardware de bajo rendimiento ("patatas").

---

## 📊 Resumen de Técnicas Implementadas

| Técnica                    | Impacto | Complejidad | Estado             |
| -------------------------- | ------- | ----------- | ------------------ |
| Adaptive Frame Rate        | Alto    | Media       | ✅ Implementado    |
| Dynamic LOD (CPU)          | Alto    | Baja        | ✅ Implementado    |
| Multi-Level Grid LOD (GPU) | Alto    | Media       | ✅ Implementado    |
| Spatial Hash O(1)          | Alto    | Baja        | ✅ Implementado    |
| LRU Projection Cache       | Medio   | Baja        | ✅ Implementado    |
| Quality Presets            | Alto    | Baja        | ✅ Implementado    |
| Object Pooling (DOM)       | Alto    | Media       | ✅ Framework listo |
| Throttled Signals          | Medio   | Baja        | ✅ Framework listo |
| Shader LOD (GPU)           | Alto    | Media       | ✅ Ya existía      |
| Quadtree Spatial           | Medio   | Media       | ✅ Ya existía      |

---

## 🎯 1. Adaptive Frame Rate Controller

**Archivo:** `performance-optimizer.ts` → `AdaptiveFrameController`

### Cómo Funciona:

1. **Mide el tiempo de cada frame** usando `performance.now()`
2. **Calcula el FPS promedio** de los últimos 30 frames
3. **Ajusta automáticamente el nivel de calidad** basado en umbrales:

```typescript
const thresholds = {
  ultra: 8ms,   // 120+ FPS
  high: 16ms,   // 60+ FPS
  medium: 25ms, // 40+ FPS
  low: 33ms,    // 30+ FPS
  potato: 50ms  // 20+ FPS
};
```

### Frame Skipping:

- En **potato mode**: Salta cada 2do frame (render a 30 FPS máximo)
- En **low mode**: Salta cada 3er frame (render a 40 FPS máximo)
- Esto libera CPU para mantener la interactividad

### Hysteresis:

Incluye un margen de 2ms para evitar "flickering" entre niveles de calidad.

---

## 🎨 2. Quality Presets Dinámicos

Cada nivel de calidad ajusta automáticamente:

| Parámetro            | Ultra  | High  | Medium | Low   | Potato |
| -------------------- | ------ | ----- | ------ | ----- | ------ |
| Max Nodes Visibles   | 10,000 | 5,000 | 2,000  | 1,000 | 500    |
| LOD High Threshold   | 0.3    | 0.4   | 0.5    | 0.6   | 0.8    |
| LOD Medium Threshold | 0.15   | 0.2   | 0.25   | 0.3   | 0.4    |
| MSAA Samples         | 4x     | 4x    | 2x     | 1x    | 1x     |
| Shadows              | ✅     | ✅    | ❌     | ❌    | ❌     |
| Animaciones          | ✅     | ✅    | ✅     | ❌    | ❌     |
| Signal Throttle      | 0ms    | 0ms   | 16ms   | 33ms  | 50ms   |

---

## 🗺️ 3. Spatial Hash (O(1) Queries)

**Antes (Quadtree):** O(log N + K) por query  
**Después (Spatial Hash):** O(K) donde K = nodos en la región

### Diferencia Clave:

- Quadtree es mejor para distribuciones **no uniformes**
- Spatial Hash es mejor para **grids uniformes** (como el nuestro)

```typescript
// Uso:
const hash = new SpatialHash(cellSize: 5);
hash.insertMany(nodes);
const visible = hash.query(minX, minY, maxX, maxY);
```

### Beneficio:

Para 10,000 nodos con 500 visibles:

- Quadtree: ~14 comparaciones + 500 inserciones
- Spatial Hash: ~100 buckets checkeados (O(1) por bucket)

---

## 💾 4. LRU Projection Cache

**Problema:** `worldToScreen()` es costoso (16 multiplicaciones + divisiones)  
**Solución:** Cache LRU de 5,000 proyecciones

### Cómo Funciona:

1. **Camera State Hash:** Si la cámara se mueve, invalida todo el cache
2. **Position Key:** `${x.toFixed(2)}_${y.toFixed(2)}_${z.toFixed(2)}`
3. **LRU Eviction:** Cuando el cache está lleno, elimina el más viejo

```typescript
// Cache hit:
worldToScreenCached(x, y, z); // O(1) lookup
// Cache miss:
worldToScreen(x, y, z); // O(1) cálculo + O(1) store
```

### Beneficio:

Para nodos estáticos, las proyecciones se calculan **solo una vez** hasta que la cámara se mueve.

---

## 🎭 5. Adaptive LOD (Level of Detail)

### Cambios en DOM:

| LOD    | Scale     | Renderizado              |
| ------ | --------- | ------------------------ |
| High   | > 0.4-0.8 | SVG con máscara completa |
| Medium | 0.2-0.4   | SVG simplificado         |
| Low    | < 0.2-0.4 | Cuadrado de color sólido |

### Ajuste Dinámico:

Los umbrales de LOD **se ajustan según el rendimiento**:

- En **potato mode**: Más nodos se renderizan como "low"
- En **ultra mode**: Más nodos se renderizan como "high"

---

## 🌐 6. Multi-Level Grid LOD (GPU Shader)

**Archivo:** `webgpu-engine.ts` → `setupGridPipeline()` shader

Esta técnica implementa un sistema de mipmapping para la cuadrícula procedural, mostrando diferentes niveles de detalle según la distancia.

### Niveles de Grid:

| Nivel | Escala  | Distancia (pixel size) | Descripción                 |
| ----- | ------- | ---------------------- | --------------------------- |
| 0     | 1x1     | w < 0.15               | Grid fino, muy cerca        |
| 1     | 10x10   | w < 1.5                | Grid medio, distancia media |
| 2     | 100x100 | w < 15.0               | Grid grueso, lejos          |
| 3+    | Sólido  | w >= 15.0              | Sin líneas, muy lejos       |

### Código WGSL:

```wgsl
// Level 0: Fine grid (1x1)
if (w < 0.15) {
  // Renderizar líneas de 1 unidad
}
// Level 1: Medium grid (10x10)
else if (w < 1.5) {
  let scale10 = 10.0;
  let gx10 = fract(x / scale10 + 0.5);
  // ...
}
// Level 2: Coarse grid (100x100)
else if (w < 15.0) {
  let scale100 = 100.0;
  // ...
}
// Level 3: Ultra-far - Solid color
```

### Beneficios:

1. **Reduce carga de GPU** al alejarse (menos cálculos de líneas)
2. **Evita efecto Moiré** en grids lejanos
3. **Transiciones suaves** con `smoothstep` fade
4. **Sin cambios de geometría** - todo en el shader

---

## 📈 7. Priority-Based Node Culling

Cuando hay más nodos que el máximo permitido:

```typescript
if (activeNodes.length > maxNodes) {
  // Priorizar por distancia al centro de cámara
  activeNodes = activeNodes
    .map((n) => ({ node: n, dist: distance(n, camera.target) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxNodes)
    .map((item) => item.node);
}
```

### Resultado:

Los nodos más cercanos siempre se renderizan; los lejanos se descartan primero.

---

## 🖥️ 8. Performance Monitor UI

Se añadió un indicador en tiempo real:

- **FPS Counter:** Verde (60+), Amarillo (30-55), Rojo (<30)
- **Quality Level:** Badge con color según nivel
- **Node Count:** Número de nodos visibles

### Activar/Desactivar:

```typescript
this.showPerformanceStats.set(false); // Ocultar en producción
```

---

## 🔮 Técnicas Futuras (Framework Listo)

### Object Pooling

```typescript
const pool = new DOMElementPool(
  () => document.createElement('div'),
  (el) => {
    el.className = '';
    el.style.cssText = '';
  },
  100, // Pre-allocate 100 elements
);

const el = pool.acquire();
// ... usar el elemento ...
pool.release(el);
```

### Computation Scheduler

```typescript
const scheduler = new ComputationScheduler();
scheduler.schedule('heavy-task', () => {
  // Trabajo pesado dividido en chunks
}, priority: 10);
```

---

## 📋 Checklist de Rendimiento

Para hardware de bajo rendimiento ("patatas"):

1. ✅ **Reduce maxVisibleNodes** a 500-1000
2. ✅ **Desactiva MSAA** (samples = 1)
3. ✅ **Usa LOD agresivo** (threshold alto)
4. ✅ **Activa frame skipping**
5. ✅ **Desactiva animaciones CSS**
6. ✅ **Usa DOM simplificado**

---

## 🧪 Cómo Probar

1. Abre DevTools → Performance
2. Throttle CPU a 6x slowdown
3. Observa cómo el nivel de calidad baja automáticamente
4. El indicador de FPS debería mantenerse > 20

---

## 📚 Referencias

- [GPU Instancing Best Practices](https://developer.nvidia.com/gpugems)
- [Spatial Hashing for Games](https://www.gamedev.net/tutorials/)
- [Angular Performance Optimization](https://angular.io/guide/performance)
