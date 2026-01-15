export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuadtreeItem extends Point {
  id: string;
  [key: string]: any;
}

export class Quadtree<T extends QuadtreeItem> {
  private items: T[] = [];
  private divided = false;
  private northwest?: Quadtree<T>;
  private northeast?: Quadtree<T>;
  private southwest?: Quadtree<T>;
  private southeast?: Quadtree<T>;

  constructor(
    private boundary: Rectangle,
    private capacity: number = 4
  ) {}

  clear() {
    this.items = [];
    this.divided = false;
    this.northwest = undefined;
    this.northeast = undefined;
    this.southwest = undefined;
    this.southeast = undefined;
  }

  insert(item: T): boolean {
    if (!this.contains(this.boundary, item)) {
      return false;
    }

    if (this.items.length < this.capacity) {
      this.items.push(item);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    if (this.northwest!.insert(item)) return true;
    if (this.northeast!.insert(item)) return true;
    if (this.southwest!.insert(item)) return true;
    if (this.southeast!.insert(item)) return true;

    return false;
  }

  query(range: Rectangle, found: T[] = []): T[] {
    if (!this.intersects(this.boundary, range)) {
      return found;
    }

    for (const item of this.items) {
      if (this.contains(range, item)) {
        found.push(item);
      }
    }

    if (this.divided) {
      this.northwest!.query(range, found);
      this.northeast!.query(range, found);
      this.southwest!.query(range, found);
      this.southeast!.query(range, found);
    }

    return found;
  }

  private subdivide() {
    const x = this.boundary.x;
    const y = this.boundary.y;
    const w = this.boundary.width / 2;
    const h = this.boundary.height / 2;

    this.northwest = new Quadtree({ x: x, y: y, width: w, height: h }, this.capacity);
    this.northeast = new Quadtree({ x: x + w, y: y, width: w, height: h }, this.capacity);
    this.southwest = new Quadtree({ x: x, y: y + h, width: w, height: h }, this.capacity);
    this.southeast = new Quadtree({ x: x + w, y: y + h, width: w, height: h }, this.capacity);

    this.divided = true;
  }

  private contains(rect: Rectangle, point: Point): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  private intersects(a: Rectangle, b: Rectangle): boolean {
    return !(
      b.x > a.x + a.width ||
      b.x + b.width < a.x ||
      b.y > a.y + a.height ||
      b.y + b.height < a.y
    );
  }
}
