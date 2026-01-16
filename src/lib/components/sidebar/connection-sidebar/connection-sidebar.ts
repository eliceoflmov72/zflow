import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SelectionService } from '../../../services/selection.service';
import { GridService } from '../../../services/grid.service';
import { FossFlowConnection } from '../../../models/fossflow.types';
import { Sidebar } from '../sidebar';

@Component({
  selector: 'connection-sidebar',
  standalone: true,
  imports: [CommonModule, Sidebar],
  templateUrl: './connection-sidebar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionSidebar {
  selectionService = inject(SelectionService);
  gridService = inject(GridService);

  @Input({ required: true }) conn!: FossFlowConnection;
  @Input({ required: true }) getAllowedDirection!: (conn: FossFlowConnection) => string;

  @Output() updateConnection = new EventEmitter<{
    id: string;
    updates: Partial<FossFlowConnection>;
  }>();
  @Output() onConnectionColorInput = new EventEmitter<{ event: any; id: string }>();
  @Output() deleteConnection = new EventEmitter<string>();
}
