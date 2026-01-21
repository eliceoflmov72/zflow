import {
  Component,
  Input,
  Output,
  EventEmitter,
  Signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Toolbar } from '../toolbar';

@Component({
  selector: 'bottom-toolbar',
  standalone: true,
  imports: [CommonModule, Toolbar],
  templateUrl: './bottom-toolbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomToolbar {
  @Input({ required: true }) currentRotationLabel!: Signal<string>;
  @Input({ required: true }) zoomLabel!: Signal<number>;
  @Input({ required: true }) showStats!: Signal<boolean>;

  @Output() rotateLeft = new EventEmitter<void>();
  @Output() rotateRight = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() zoomIn = new EventEmitter<void>();
  @Output() resetView = new EventEmitter<void>();
  @Output() toggleStats = new EventEmitter<void>();
}
