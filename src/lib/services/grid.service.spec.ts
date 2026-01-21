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

    // Default mock behavior
    storageSpy.loadNodes.and.returnValue([]);
    storageSpy.loadConnections.and.returnValue([]);

    TestBed.configureTestingModule({
      providers: [
        GridService,
        { provide: StorageService, useValue: storageSpy },
        { provide: ConnectionService, useValue: connectionSpy },
        { provide: PLATFORM_ID, useValue: 'server' }, // Mock as server to avoid browser-specific effects
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
      // Force initialization since we are "server" and constructor skipped logic?
      // GridService.initializeGrid doesn't check platform, but constructor loading execution does.

      service.initializeGrid(10, 10, true);

      const uniqueColor = '#123456';

      service.nodes.update((nodes) => {
        if (nodes.length === 0) return nodes;
        const node = nodes[0];
        return [{ ...node, active: true, color: uniqueColor }, ...nodes.slice(1)];
      });

      // trigger change detection or signal update?
      // Signals update synchronously when pulled.

      const colors = service.usedColors();
      expect(colors).toContain(uniqueColor);
    });

    it('should update usedColors when a floor color is changed', () => {
      service.initializeGrid(10, 10, true);

      const uniqueFloorColor = '#654321';

      service.nodes.update((nodes) => {
        if (nodes.length === 0) return nodes;
        const node = nodes[0];
        return [{ ...node, floorColor: uniqueFloorColor }, ...nodes.slice(1)];
      });

      const colors = service.usedColors();
      expect(colors).toContain(uniqueFloorColor);
    });
  });
});
