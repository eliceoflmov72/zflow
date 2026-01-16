import {
  Component,
  Input,
  WritableSignal,
  Signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Toolbar } from '../toolbar';

@Component({
  selector: 'top-toolbar',
  standalone: true,
  imports: [CommonModule, Toolbar],
  templateUrl: './top-toolbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopToolbar {
  @Input({ required: true }) editorMode!: WritableSignal<
    'select' | 'pan' | 'connect' | 'paint' | 'paint-floor'
  >;
  @Input({ required: true }) connectionStyle!: WritableSignal<'straight' | 'rounded'>;
  @Input({ required: true }) currentLineType!: WritableSignal<'solid' | 'dashed'>;
  @Input({ required: true }) isFullscreen!: Signal<boolean>;
  @Input({ required: true }) showClearConfirm!: WritableSignal<boolean>;
  @Input({ required: true }) undo!: () => void;
  @Input({ required: true }) redo!: () => void;

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
