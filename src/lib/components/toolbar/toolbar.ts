import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ToolbarVariant = 'rounded' | 'semi-rounded';
export type ToolbarPosition =
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-left'
  | 'top-right';

@Component({
  selector: 'toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Toolbar {
  /**
   * Variante del estilo de la toolbar:
   * - 'rounded': Bordes muy redondeados (99px) - estilo pill
   * - 'semi-rounded': Bordes moderadamente redondeados (12px)
   */
  @Input() variant: ToolbarVariant = 'rounded';

  /**
   * Posición de la toolbar en el contenedor:
   * - 'top-center': Centrada arriba
   * - 'bottom-right': Abajo a la derecha
   * - 'bottom-left': Abajo a la izquierda
   * - 'top-left': Arriba a la izquierda
   * - 'top-right': Arriba a la derecha
   */
  @Input() position: ToolbarPosition = 'top-center';
}
