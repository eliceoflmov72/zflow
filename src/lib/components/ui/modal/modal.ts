import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen) {
      <div class="zmodal-backdrop" (click)="onCancel()"></div>
      <div class="zmodal">
        <div class="zmodal-header">
          <h3 class="zmodal-title">{{ title }}</h3>
        </div>
        <div class="zmodal-body">
          <p class="zmodal-description">{{ description }}</p>
        </div>
        <div class="zmodal-footer">
          <button class="zbtn zbtn-secondary" type="button" (click)="onCancel()">
            {{ cancelButtonText || 'Cancelar' }}
          </button>
          <button
            class="zbtn"
            [class.zbtn-primary]="confirmButtonType === 'primary'"
            [class.zbtn-danger]="confirmButtonType === 'danger'"
            [class.zbtn-success]="confirmButtonType === 'success'"
            [class.zbtn-warning]="confirmButtonType === 'warning'"
            type="button"
            (click)="onConfirm()"
          >
            {{ confirmButtonText || 'Confirmar' }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .zmodal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.45);
        z-index: 1000;
      }
      .zmodal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        width: 520px;
        max-width: calc(100vw - 2rem);
        border-radius: 12px;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .zmodal-header {
        padding: 1rem 1.25rem;
        border-bottom: 1px solid #e5e7eb;
      }
      .zmodal-title {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 700;
        color: #0f172a;
      }
      .zmodal-body {
        padding: 1rem 1.25rem;
        color: #334155;
      }
      .zmodal-description {
        margin: 0;
        line-height: 1.5;
      }
      .zmodal-footer {
        padding: 0.75rem 1.25rem;
        border-top: 1px solid #e5e7eb;
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
      .zbtn {
        padding: 0.5rem 0.875rem;
        font-weight: 600;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .zbtn-primary {
        background: #2563eb;
        color: #fff;
        border-color: #1d4ed8;
      }
      .zbtn-danger {
        background: #ef4444;
        color: #fff;
        border-color: #dc2626;
      }
      .zbtn-success {
        background: #16a34a;
        color: #fff;
        border-color: #15803d;
      }
      .zbtn-warning {
        background: #f59e0b;
        color: #fff;
        border-color: #d97706;
      }
      .zbtn-secondary {
        background: #f1f5f9;
        color: #0f172a;
        border-color: #e2e8f0;
      }
    `,
  ],
})
export class ModalComponent<T = any> {
  @Input() title = '';
  @Input() description = '';
  @Input() confirmButtonText = '';
  @Input() cancelButtonText = '';
  @Input() isOpen = false;
  @Input() data?: T;
  @Input() confirmButtonType: 'primary' | 'danger' | 'success' | 'warning' = 'primary';

  @Output() closeAction = new EventEmitter<void>();
  @Output() confirmAction = new EventEmitter<void | T>();

  onCancel(): void {
    this.closeAction.emit();
  }
  onConfirm(): void {
    this.confirmAction.emit(this.data);
  }
}

