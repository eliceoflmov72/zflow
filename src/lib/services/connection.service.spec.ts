import { TestBed } from '@angular/core/testing';
import { ConnectionService } from './connection.service';
import { Node } from '../models/fossflow.types';

describe('ConnectionService', () => {
  let service: ConnectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ConnectionService],
    });
    service = TestBed.inject(ConnectionService);
  });

  const mockNodes: Node[] = [
    {
      id: '1',
      position: { x: 0, y: 0 },
      title: 'N1',
      description: '',
      shape3D: '',
      color: '',
      floorColor: '',
      active: true,
    },
    {
      id: '2',
      position: { x: 5, y: 5 },
      title: 'N2',
      description: '',
      shape3D: '',
      color: '',
      floorColor: '',
      active: true,
    },
    {
      id: 'obs',
      position: { x: 2, y: 2 },
      title: 'Obs',
      description: '',
      shape3D: '',
      color: '',
      floorColor: '',
      active: true,
    }, // Obstacle
    {
      id: 'inactive',
      position: { x: 3, y: 3 },
      title: 'Inact',
      description: '',
      shape3D: '',
      color: '',
      floorColor: '',
      active: false,
    }, // Not an obstacle
  ];

  const gridSize = { width: 10, height: 10 };

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createConnection', () => {
    it('should create a basic connection with auto-path', () => {
      const conn = service.createConnection('1', '2', mockNodes, gridSize);
      expect(conn.id).toBeDefined();
      expect(conn.fromId).toBe('1');
      expect(conn.toId).toBe('2');
      expect(conn.path).toBeDefined();
      expect(conn.path!.length).toBeGreaterThan(1);
    });

    it('should generate a self-loop when fromId === toId', () => {
      const conn = service.createConnection('1', '1', mockNodes, gridSize);
      expect(conn.fromId).toBe('1');
      expect(conn.toId).toBe('1');
      expect(conn.path).toBeDefined();
      // Should have 5 points (start, 3 intermediate, end/start)
      expect(conn.path!.length).toBe(5);
    });
  });

  describe('pathfinding', () => {
    it('should find a path avoiding active obstacles', () => {
      // Path from (0,0) to (5,5) should not include (2,2)
      const conn = service.createConnection('1', '2', mockNodes, gridSize);
      const includesObstacle = conn.path?.some((p) => p.x === 2 && p.y === 2);
      expect(includesObstacle).toBeFalse();
    });

    it('should NOT avoid inactive nodes (they are not obstacles)', () => {
      // Point (3,3) is occupied by an inactive node, so it's a valid tile to step on
      // A* might use it or not, but it shouldn't be blocked.
      const start = { x: 2, y: 3 };
      const end = { x: 4, y: 3 };
      // Deep call to internal pathfinding (testing via createConnection)
      const conn = service.createConnection(
        'custom_start',
        'custom_end',
        [
          ...mockNodes,
          { id: 'custom_start', position: start, active: true } as any,
          { id: 'custom_end', position: end, active: true } as any,
        ],
        gridSize,
      );

      const includesPoint = conn.path?.some((p) => p.x === 3 && p.y === 3);
      // In a straight line 2,3 -> 4,3, point 3,3 is mandatory.
      expect(includesPoint).toBeTrue();
    });
  });

  describe('tile occupancy', () => {
    it('should detect if a tile is occupied by a connection', () => {
      const conn = service.createConnection('1', '2', mockNodes, gridSize);
      const connections = [conn];

      // Pick a point from the generated path
      const midPoint = conn.path![Math.floor(conn.path!.length / 2)];
      const isOccupied = service.isTileOccupiedByConnection(
        midPoint.x,
        midPoint.y,
        connections,
        mockNodes,
      );
      expect(isOccupied).toBeTrue();
    });
  });
});
