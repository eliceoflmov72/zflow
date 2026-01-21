import {
  Component,
  Input,
  Output,
  EventEmitter,
  Signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SelectionService } from '../../../services/selection.service';
import { FossFlowNode } from '../../../models/fossflow.types';
import { Sidebar } from '../sidebar';
import { VisualObjectsTab } from '../../visual-objects-tab/visual-objects-tab';

@Component({
  selector: 'selection-sidebar',
  standalone: true,
  imports: [CommonModule, Sidebar, VisualObjectsTab],
  templateUrl: './selection-sidebar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionSidebar {
  selectionService = inject(SelectionService);

  @Input({ required: true }) selectedNodes: FossFlowNode[] = [];
  @Input({ required: true }) availableSvgs!: Signal<string[]>;
  @Input({ required: true }) recentColors!: Signal<string[]>;

  @Output() updateSelectedNodes = new EventEmitter<Partial<FossFlowNode>>();
  @Output() deleteSelected = new EventEmitter<void>();

  get isSingleSelection(): boolean {
    return this.selectedNodes.length === 1;
  }

  get singleNode(): FossFlowNode | null {
    return this.isSingleSelection ? this.selectedNodes[0] : null;
  }

  get sidebarTitle(): string {
    if (this.isSingleSelection) {
      return 'Ajustes del Objeto'; // Single node title
    }
    return `Selección Múltiple (${this.selectedNodes.length})`;
  }
}
