import {
  Component,
  Input,
  WritableSignal,
  Signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { GridService } from '../../../services/grid.service';
import { Toolbar } from '../toolbar';

@Component({
  selector: 'top-toolbar',
  standalone: true,
  imports: [CommonModule, Toolbar],
  templateUrl: './top-toolbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopToolbar {
  gridService = inject(GridService);

  @Input({ required: true }) editorMode!: WritableSignal<
    'select' | 'pan' | 'connect' | 'paint' | 'paint-floor'
  >;
  @Input({ required: true }) connectionStyle!: WritableSignal<'straight' | 'rounded'>;
  @Input({ required: true }) currentLineType!: WritableSignal<'solid' | 'dashed'>;
  @Input({ required: true }) isFullscreen!: Signal<boolean>;
  @Input({ required: true }) showClearConfirm!: WritableSignal<boolean>;

  setConnectMode(style: 'straight' | 'rounded') {
    this.editorMode.set('connect');
    this.connectionStyle.set(style);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }
}
