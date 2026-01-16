import { Injectable, signal, computed } from '@angular/core';

@Injectable()
export class SelectionService {
  selectedNodeIds = signal<string[]>([]);
  selectedConnectionId = signal<string | null>(null);
  
  // selectedNodeId (single) for backward compat / ease of use in single-selection contexts
  selectedNodeId = computed(() =>
    this.selectedNodeIds().length > 0 ? this.selectedNodeIds()[0] : null,
  );

  selectNode(id: string | null, multi = false) {
    if (id === null) {
      this.selectedNodeIds.set([]);
      return;
    }

    this.selectedConnectionId.set(null); // Clear connection selection

    if (multi) {
      this.selectedNodeIds.update((ids) => {
        if (ids.includes(id)) {
          return ids.filter((existing) => existing !== id);
        }
        return [...ids, id];
      });
    } else {
      this.selectedNodeIds.set([id]);
    }
  }

  setSelection(ids: string[]) {
    this.selectedNodeIds.set(ids);
    if (ids.length > 0) this.selectedConnectionId.set(null);
  }

  selectConnection(id: string | null) {
    this.selectedConnectionId.set(id);
    if (id) this.selectedNodeIds.set([]);
  }

  clearSelection() {
    this.selectedNodeIds.set([]);
    this.selectedConnectionId.set(null);
  }
}
