import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type SidebarPosition = 'left' | 'right';

@Component({
  selector: 'sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  /**
   * Título del sidebar que se muestra en el header
   */
  @Input() title: string = '';

  /**
   * Posición del sidebar:
   * - 'right': A la derecha (por defecto)
   * - 'left': A la izquierda
   */
  @Input() position: SidebarPosition = 'right';

  /**
   * Mostrar u ocultar el botón de cerrar
   */
  @Input() showCloseButton: boolean = true;

  /**
   * Evento emitido cuando se hace click en el botón de cerrar
   */
  @Output() close = new EventEmitter<void>();
}
