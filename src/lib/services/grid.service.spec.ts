import { TestBed } from '@angular/core/testing';
import { GridService } from './grid.service';
import { StorageService } from './storage.service';
import { ConnectionService } from './connection.service';
import { PLATFORM_ID } from '@angular/core';

describe('GridService', () => {
  let service: GridService;
  let storageServiceSpy: jasmine.SpyObj<StorageService>;
  let connectionServiceSpy: jasmine.SpyObj<ConnectionService>;

  beforeEach(() => {
    const storageSpy = jasmine.createSpyObj('StorageService', [
      'loadNodes',
      'loadConnections',
      'saveState',
      'clearStorage',
    ]);
    const connectionSpy = jasmine.createSpyObj('ConnectionService', [
      'createConnection',
      'updateConnection',
      'removeConnection',
      'isTileOccupiedByConnection',
    ]);
    connectionSpy.isTileOccupiedByConnection.and.returnValue(false);

    // Default mock behavior
    storageSpy.loadNodes.and.returnValue([]);
    storageSpy.loadConnections.and.returnValue([]);

    TestBed.configureTestingModule({
      providers: [
        GridService,
        { provide: StorageService, useValue: storageSpy },
        { provide: ConnectionService, useValue: connectionSpy },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(GridService);
    storageServiceSpy = TestBed.inject(StorageService) as jasmine.SpyObj<StorageService>;
    connectionServiceSpy = TestBed.inject(ConnectionService) as jasmine.SpyObj<ConnectionService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initialization', () => {
    it('should calculate usedColors correctly from defaults', () => {
      expect(service.usedColors).toBeDefined();
      const colors = service.usedColors();
      expect(colors).toContain('#3b82f6'); // default blue
      expect(colors).toContain('#ffffff'); // default white
    });
  });

  describe('color tracking', () => {
    it('should update usedColors when a node with new color is added', () => {
      service.initializeGrid(10, 10, true);
      TestBed.flushEffects();

      const uniqueColor = '#123456';

      service.nodes.update((nodes) => {
        if (nodes.length === 0) return nodes;
        const node = nodes[0];
        return [{ ...node, active: true, color: uniqueColor }, ...nodes.slice(1)];
      });
      TestBed.flushEffects();

      const colors = service.usedColors();
      expect(colors).toContain(uniqueColor);
    });

    it('should update usedColors when a floor color is changed', () => {
      service.initializeGrid(10, 10, true);
      TestBed.flushEffects();

      const uniqueFloorColor = '#654321';

      service.nodes.update((nodes) => {
        if (nodes.length === 0) return nodes;
        const node = nodes[0];
        return [{ ...node, floorColor: uniqueFloorColor }, ...nodes.slice(1)];
      });
      TestBed.flushEffects();

      const colors = service.usedColors();
      expect(colors).toContain(uniqueFloorColor);
    });
  });

  describe('edit limit', () => {
    it('should track modifiedNodesCount correctly', () => {
      service.initializeGrid(10, 10, true);
      TestBed.flushEffects();
      expect(service.modifiedNodesCount()).toBe(0);

      service.paintNode(1, 1, {
        objectEnabled: true,
        floorEnabled: false,
        shape: 'cube.svg',
        objectColor: '#000000',
      });
      TestBed.flushEffects();
      expect(service.modifiedNodesCount()).toBe(1);

      service.paintNode(2, 2, { floorEnabled: true, objectEnabled: false, floorColor: '#ff0000' });
      TestBed.flushEffects();
      expect(service.modifiedNodesCount()).toBe(2);
    });

    it('should block edits when limit (60) is reached', () => {
      service.initializeGrid(20, 20, true);
      TestBed.flushEffects();

      expect(service.modifiedNodesCount()).toBe(0);
      service.limitReached.set(false);

      const coords = [];
      for (let i = 0; i < 60; i++) {
        coords.push({ x: i % 20, y: Math.floor(i / 20) });
      }

      service.paintBatch(coords, {
        objectEnabled: true,
        shape: 'cube.svg',
        objectColor: '#3b82f6',
        floorEnabled: false,
      });
      TestBed.flushEffects();

      const countBefore = service.modifiedNodesCount();
      expect(countBefore).toBe(60);
      expect(service.limitReached()).toBeFalse();

      // 61st edit (individual) at a coordinate NOT in the previous batch
      const changed = service.paintNode(15, 15, {
        objectEnabled: true,
        shape: 'cube.svg',
        objectColor: '#3b82f6',
        floorEnabled: false,
      });

      expect(changed).toBeFalse();
      expect(service.limitReached()).toBeTrue();
    });
  });

  describe('batch operations', () => {
    it('should paint a rectangle of tiles', () => {
      service.initializeGrid(10, 10, true);
      TestBed.flushEffects();

      service.paintRectangle(1, 1, 3, 3, {
        objectEnabled: true,
        shape: 'cube.svg',
        objectColor: '#00ff00',
        floorEnabled: false,
      });
      TestBed.flushEffects();

      const node11 = service.getNodeAt(1, 1);
      const node33 = service.getNodeAt(3, 3);
      const node44 = service.getNodeAt(4, 4);

      expect(node11?.active).toBeTrue();
      expect(node33?.active).toBeTrue();
      expect(node44?.active).toBeFalse();
      expect(service.modifiedNodesCount()).toBe(9);
    });
  });
});
