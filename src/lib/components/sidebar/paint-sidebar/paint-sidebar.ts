import {
  Component,
  Input,
  Signal,
  WritableSignal,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sidebar } from '../sidebar';
import { VisualObjectsTab } from '../../visual-objects-tab/visual-objects-tab';

@Component({
  selector: 'paint-sidebar',
  standalone: true,
  imports: [CommonModule, Sidebar, VisualObjectsTab],
  templateUrl: './paint-sidebar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaintSidebar {
  @Input({ required: true }) paintTool!: WritableSignal<'brush' | 'rectangle'>;
  @Input({ required: true }) paintObjectEnabled!: WritableSignal<boolean>;
  @Input({ required: true }) paintFloorEnabled!: WritableSignal<boolean>;
  @Input({ required: true }) brushShape!: WritableSignal<string>;
  @Input({ required: true }) brushObjectColor!: WritableSignal<string>;
  @Input({ required: true }) brushFloorColor!: WritableSignal<string>;
  @Input({ required: true }) availableSvgs!: Signal<string[]>;
  @Input({ required: true }) recentColors!: Signal<string[]>;

  isImageShape = computed(() => {
    const shape = this.brushShape();
    return shape ? shape.toLowerCase().endsWith('.png') : false;
  });
}
