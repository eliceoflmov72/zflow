import { SelectionService } from './selection.service';

describe('SelectionService', () => {
  let service: SelectionService;

  beforeEach(() => {
    service = new SelectionService();
  });

  it('should select a single node', () => {
    service.selectNode('1');
    expect(service.selectedNodeIds()).toEqual(['1']);
    expect(service.selectedNodeId()).toBe('1');
  });

  it('should handle multi-selection', () => {
    service.selectNode('1');
    service.selectNode('2', true);
    expect(service.selectedNodeIds()).toEqual(['1', '2']);

    // Toggle off
    service.selectNode('1', true);
    expect(service.selectedNodeIds()).toEqual(['2']);
  });

  it('should clear node selection when a connection is selected', () => {
    service.selectNode('1');
    service.selectConnection('conn1');
    expect(service.selectedNodeIds()).toEqual([]);
    expect(service.selectedConnectionId()).toBe('conn1');
  });

  it('should clear connection selection when a node is selected', () => {
    service.selectConnection('conn1');
    service.selectNode('1');
    expect(service.selectedConnectionId()).toBeNull();
    expect(service.selectedNodeIds()).toEqual(['1']);
  });

  it('should clear all selection', () => {
    service.selectNode('1');
    service.clearSelection();
    expect(service.selectedNodeIds()).toEqual([]);
    expect(service.selectedConnectionId()).toBeNull();
  });
});
