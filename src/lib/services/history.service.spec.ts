import { HistoryService, State } from './history.service';

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  const mockState1: State = { nodes: [{ id: '1' } as any], connections: [] };
  const mockState2: State = { nodes: [{ id: '1' } as any, { id: '2' } as any], connections: [] };

  it('should push and undo state', () => {
    service.pushState(mockState1);
    service.pushState(mockState2);

    expect(service.canUndo()).toBeTrue();
    const undone = service.undo(mockState2);
    expect(undone!.nodes[0].id).toBe(mockState1.nodes[0].id);
  });

  it('should redo state', () => {
    service.pushState(mockState1);
    service.pushState(mockState2);

    service.undo(mockState2);
    expect(service.canRedo()).toBeTrue();

    const redone = service.redo(mockState1);
    expect(redone).toEqual(mockState2);
  });

  it('should limit history size', () => {
    for (let i = 0; i < 30; i++) {
      service.pushState({ nodes: [{ id: `${i}` } as any], connections: [] });
    }

    // Internal limit is 20
    // After 30 pushes, we should only be able to undo 20 times?
    // Actually the implementation says if length > 20, shift.
    // So 30 pushes result in 20 items in array.

    let undoCount = 0;
    let s = { nodes: [], connections: [] };
    while (service.canUndo()) {
      service.undo(s as any);
      undoCount++;
    }
    expect(undoCount).toBe(20);
  });

  it('should clear future on new push', () => {
    service.pushState(mockState1);
    service.pushState(mockState2);
    service.undo(mockState2);
    expect(service.canRedo()).toBeTrue();

    service.pushState({ nodes: [], connections: [] });
    expect(service.canRedo()).toBeFalse();
  });
});
