import { Mat4 } from './math-utils';

export class Camera {
  position = { x: 30, y: 30, z: 30 };
  target = { x: 0, y: 0, z: 0 };
  up = { x: 0, y: 1, z: 0 };

  private _zoom = 45; // Field of View en grados
  private _aspect = 1;
  private _rotation = 45; // Ángulo de rotación en grados

  // Isometric movement constants
  private readonly ISO_NE = { x: 0, z: -1 };
  private readonly ISO_NW = { x: -1, z: 0 };
  private readonly ISO_SE = { x: 1, z: 0 };
  private readonly ISO_SW = { x: 0, z: 1 };

  // Reusable matrix buffers
  private readonly projection = new Float32Array(16);
  private readonly view = new Float32Array(16);
  private readonly vp = new Float32Array(16);
  private readonly invVP = new Float32Array(16);

  // Temporary buffers for ray calculations
  private readonly tempNear = new Float32Array(3);
  private readonly tempFar = new Float32Array(3);
  private readonly tempDir = new Float32Array(3);

  // Dirty flag
  private dirty = true;

  // Getters / Setters para zoom, aspect y rotation (marcan dirty automáticamente)
  public get zoom(): number {
    return this._zoom;
  }
  public set zoom(value: number) {
    // Zoom range: 200% to 325% (FOV 10.285 to 15)
    this._zoom = Math.max(10.285, Math.min(15, value));
    this.markDirty();
  }

  public get aspect(): number {
    return this._aspect;
  }
  public set aspect(value: number) {
    this._aspect = value;
    this.markDirty();
  }

  public get rotation(): number {
    return this._rotation;
  }
  public set rotation(value: number) {
    this._rotation = value;
    this.markDirty();
  }

  private updateMatrices() {
    if (!this.dirty) return;

    const fov = (this._zoom * Math.PI) / 180;
    Mat4.perspective(this.projection, fov, this._aspect, 0.1, 5000);

    // Calculate position based on rotation and target
    // The distance in XZ plane is kept constant to maintain isometric feel
    const distXZ = 42.426; // sqrt(30^2 + 30^2)
    const rad = (this._rotation * Math.PI) / 180;
    this.position.x = this.target.x + distXZ * Math.cos(rad);
    this.position.z = this.target.z + distXZ * Math.sin(rad);
    this.position.y = 30;

    Mat4.lookAt(
      this.view,
      [this.position.x, this.position.y, this.position.z],
      [this.target.x, this.target.y, this.target.z],
      [this.up.x, this.up.y, this.up.z],
    );

    Mat4.multiply(this.vp, this.projection, this.view);
    Mat4.inverse(this.invVP, this.vp);

    this.dirty = false;
  }

  getViewProjectionMatrix(): Float32Array {
    this.updateMatrices();
    return this.vp;
  }

  getRightVector(): Float32Array {
    this.updateMatrices();
    // Row 0 of View Matrix (Column Major: 0, 4, 8)
    return new Float32Array([this.view[0], this.view[4], this.view[8]]);
  }

  getUpVector(): Float32Array {
    this.updateMatrices();
    // Row 1 of View Matrix (Column Major: 1, 5, 9)
    return new Float32Array([this.view[1], this.view[5], this.view[9]]);
  }

  /** Marca las matrices como desactualizadas (útil si modificas position/target directamente) */
  public markDirty() {
    this.dirty = true;
  }

  pan(dx: number, dz: number) {
    this.target.x += dx;
    this.target.z += dz;
    this.markDirty();
  }

  panScreen(dx: number, dy: number, width: number, height: number) {
    this.updateMatrices();

    const ray1 = this.getRay(width / 2, height / 2, width, height);
    // Copy because subsequent call to getRay will overwrite shared buffers
    const origin1 = new Float32Array(ray1.origin);
    const dir1 = new Float32Array(ray1.direction);

    const ray2 = this.getRay(width / 2 - dx, height / 2 - dy, width, height);

    const hit1 = this.intersectPlaneXZ({ origin: origin1, direction: dir1 });
    const hit2 = this.intersectPlaneXZ(ray2);

    if (hit1 && hit2) {
      const worldDX = hit2.x - hit1.x;
      const worldDZ = hit2.z - hit1.z;
      this.pan(worldDX, worldDZ);
    }
  }

  moveIsometric(direction: 'up' | 'down' | 'left' | 'right', speed: number = 0.5) {
    let moveX = 0;
    let moveZ = 0;

    // Base movements in world space for 45 deg rotation
    switch (direction) {
      case 'up':
        moveX = -1;
        moveZ = -1;
        break;
      case 'down':
        moveX = 1;
        moveZ = 1;
        break;
      case 'left':
        moveX = -1;
        moveZ = 1;
        break;
      case 'right':
        moveX = 1;
        moveZ = -1;
        break;
    }

    // Rotate the movement vector to match the current camera orientation
    // We want the movement to be relative to the screen view
    // Current camera is at 'rotation' Angle. 45 deg is the "standard" where ISO_NE etc were defined.
    // However, the original code had:
    // ISO_NE = { x: 0, z: -1 }; (Up-Right in screen?)
    // Actually, let's just rotate the vector by (rotation - 45) degrees
    const rad = ((this._rotation - 45) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatedX = moveX * cos - moveZ * sin;
    const rotatedZ = moveX * sin + moveZ * cos;

    this.pan(rotatedX * speed, rotatedZ * speed);
  }

  setIsometric(centerX: number = 0, centerZ: number = 0, rotation: number = 45) {
    this.target = { x: centerX, y: 0, z: centerZ };
    this._rotation = rotation;
    this._zoom = 12.857; // 250% default zoom
    this.markDirty();
  }

  getRay(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { origin: Float32Array; direction: Float32Array } {
    this.updateMatrices();

    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1;

    this.unproject([nx, ny, 0], this.invVP, this.tempNear);
    this.unproject([nx, ny, 1], this.invVP, this.tempFar);

    this.tempDir[0] = this.tempFar[0] - this.tempNear[0];
    this.tempDir[1] = this.tempFar[1] - this.tempNear[1];
    this.tempDir[2] = this.tempFar[2] - this.tempNear[2];

    const len = Math.hypot(this.tempDir[0], this.tempDir[1], this.tempDir[2]);
    if (len > 0) {
      this.tempDir[0] /= len;
      this.tempDir[1] /= len;
      this.tempDir[2] /= len;
    }

    return { origin: this.tempNear, direction: this.tempDir };
  }

  private unproject(point: number[], invVP: Float32Array, out: Float32Array): void {
    const x = point[0],
      y = point[1],
      z = point[2];

    const w = invVP[3] * x + invVP[7] * y + invVP[11] * z + invVP[15];
    const invW = w === 0 ? 0 : 1 / w;

    out[0] = (invVP[0] * x + invVP[4] * y + invVP[8] * z + invVP[12]) * invW;
    out[1] = (invVP[1] * x + invVP[5] * y + invVP[9] * z + invVP[13]) * invW;
    out[2] = (invVP[2] * x + invVP[6] * y + invVP[10] * z + invVP[14]) * invW;
  }

  intersectPlaneXZ(ray: {
    origin: Float32Array;
    direction: Float32Array;
  }): { x: number; z: number } | null {
    const dirY = ray.direction[1];
    if (Math.abs(dirY) < 0.0001) return null;

    const t = -ray.origin[1] / dirY;
    if (t < 0) return null;

    return {
      x: ray.origin[0] + ray.direction[0] * t,
      z: ray.origin[2] + ray.direction[2] * t,
    };
  }
}
