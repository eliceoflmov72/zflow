import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';
import { PLATFORM_ID } from '@angular/core';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    // Mock for localStorage
    const store: Record<string, string> = {};
    spyOn(localStorage, 'getItem').and.callFake((key) => store[key] || null);
    spyOn(localStorage, 'setItem').and.callFake((key, value) => (store[key] = value));
    spyOn(localStorage, 'removeItem').and.callFake((key) => delete store[key]);

    TestBed.configureTestingModule({
      providers: [StorageService, { provide: PLATFORM_ID, useValue: 'browser' }],
    });
    service = TestBed.inject(StorageService);
  });

  it('should save and load nodes', () => {
    const nodes = [{ id: '1' } as any];
    service.saveNodes(nodes);
    const loaded = service.loadNodes();
    expect(loaded).toEqual(nodes);
  });

  it('should return null if no nodes saved', () => {
    expect(service.loadNodes()).toBeNull();
  });

  it('should clear storage', () => {
    service.saveNodes([{ id: '1' } as any]);
    service.clearStorage();
    expect(service.loadNodes()).toBeNull();
  });
});
