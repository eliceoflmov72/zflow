import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ff-tab',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class.hidden]="!active()" class="ff-tab-pane">
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      .hidden {
        display: none;
      }
      .ff-tab-pane {
        padding-top: 1rem;
        animation: fadeIn 0.2s ease;
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class Tab {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) id!: string;
  active = signal(false);
}
