import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ModalVisibilityDirective } from './modal-visibility.directive';

@Component({
  selector: 'modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modal.component.html',
  styleUrls: ['./modal.component.css'],
  hostDirectives: [
    {
      directive: ModalVisibilityDirective,
      inputs: ['isVisible: isOpen'],
    },
  ],
})
export class ModalComponent<T = any> {
  @Input() title: string = '';
  @Input() description: string = '';
  @Input() confirmButtonText: string = '';
  @Input() cancelButtonText: string = '';
  @Input() isOpen: boolean = false;
  @Input() data?: T;
  @Input() confirmButtonType: 'primary' | 'danger' | 'success' | 'warning' = 'primary';
  @Input() customConfirmColor?: string;

  @Output() closeAction = new EventEmitter<void>();
  @Output() confirmAction = new EventEmitter<T | void>();

  onCancel(): void {
    this.closeAction.emit();
  }

  onConfirm(): void {
    this.confirmAction.emit(this.data);
  }
}
