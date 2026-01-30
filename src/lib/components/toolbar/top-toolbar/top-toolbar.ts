import { Component, Input, WritableSignal, Signal, ChangeDetectionStrategy } from '@angular/core';
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

  getFullscreenIcon() {
    if (typeof document === 'undefined') return 'fullscreen.svg';
    return this.isFullscreen() ? 'fullscreen-exit.svg' : 'fullscreen.svg';
  }

  toggleFullscreen() {
    if (typeof document === 'undefined') return;
    const editorContainer = document.querySelector(
      'zflow-editor .ff-container',
    ) as HTMLElement | null;
    if (!editorContainer) return;

    const isOsFullscreen = document.fullscreenElement === editorContainer;

    if (isOsFullscreen) {
      document.exitFullscreen?.();
      editorContainer.classList.remove('fullscreen-mode');
      return;
    }

    // Ensure the editor fills the viewport and then request OS fullscreen for THIS element
    editorContainer.classList.add('fullscreen-mode');
    const req = editorContainer.requestFullscreen?.();
    // If fullscreen is rejected, rollback the css fullscreen so we don't leave a half-state.
    if (req && typeof (req as Promise<void>).catch === 'function') {
      (req as Promise<void>).catch(() => {
        editorContainer.classList.remove('fullscreen-mode');
      });
    }
  }
}
