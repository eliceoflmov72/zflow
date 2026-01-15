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
import { GridService } from '../../../services/grid.service';
import { FossFlowNode } from '../../../models/fossflow.types';
import { Sidebar } from '../sidebar';
import { VisualObjectsTab } from '../../visual-objects-tab/visual-objects-tab';

@Component({
  selector: 'node-sidebar',
  standalone: true,
  imports: [CommonModule, Sidebar, VisualObjectsTab],
  templateUrl: './node-sidebar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeSidebar {
  gridService = inject(GridService);

  @Input({ required: true }) node!: FossFlowNode;
  @Input({ required: true }) availableSvgs!: Signal<string[]>;
  @Input({ required: true }) recentColors!: Signal<string[]>;

  @Output() removeObject = new EventEmitter<FossFlowNode>();
  @Output() selectObject = new EventEmitter<{ svg: string; node: FossFlowNode }>();
  @Output() onObjectColorInput = new EventEmitter<{ event: any; node: FossFlowNode }>();
  @Output() onFloorColorInput = new EventEmitter<{ event: any; node: FossFlowNode }>();
  @Output() applyRecentColorToObject = new EventEmitter<{ color: string; node: FossFlowNode }>();
  @Output() applyRecentColorToFloor = new EventEmitter<{ color: string; node: FossFlowNode }>();
  @Output() deleteSelected = new EventEmitter<void>();
}
