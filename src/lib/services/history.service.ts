import { Injectable } from '@angular/core';
import { FossFlowNode, FossFlowConnection } from '../models/fossflow.types';

export interface FossFlowState {
  nodes: FossFlowNode[];
  connections: FossFlowConnection[];
}

@Injectable()
export class HistoryService {
  private history: string[] = [];
  private future: string[] = [];

  pushState(state: FossFlowState) {
    const stateString = JSON.stringify(state);
    // Only push if different from last
    if (this.history.length > 0 && this.history[this.history.length - 1] === stateString) return;

    this.history.push(stateString);
    // Optimization: Reduce history size to save memory
    if (this.history.length > 20) this.history.shift(); // Limit history
    this.future = []; // Clear future on new action
  }

  undo(currentState: FossFlowState): FossFlowState | null {
    if (this.history.length === 0) return null;

    const currentStateString = JSON.stringify(currentState);
    this.future.push(currentStateString);

    const prevState = JSON.parse(this.history.pop()!);
    return prevState;
  }

  redo(currentState: FossFlowState): FossFlowState | null {
    if (this.future.length === 0) return null;

    const currentStateString = JSON.stringify(currentState);
    this.history.push(currentStateString);

    const nextState = JSON.parse(this.future.pop()!);
    return nextState;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }
}
