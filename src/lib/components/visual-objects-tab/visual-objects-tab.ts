import { Component, Input, Output, EventEmitter, Signal, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tabs } from '../ui/tabs/tabs';
import { Tab } from '../ui/tabs/tab';

@Component({
  selector: 'visual-objects-tab',
  standalone: true,
  imports: [CommonModule, Tabs, Tab],
  template: `
    <tabs>
      <tab label="Formas" id="forms">
        <div class="ff-object-gallery">
          @if (allowClear) {
            <div
              class="ff-gallery-item"
              [class.active]="!currentShape && allowClear"
              (click)="selectShape.emit(null)"
              title="Sin Objeto"
            >
              <div
                class="ff-gallery-preview mask-preview"
                style="mask-image: url(/icons/no-object.svg); -webkit-mask-image: url(/icons/no-object.svg);"
              ></div>
            </div>
          }
          @for (svg of availableForms(); track svg) {
            <div
              class="ff-gallery-item"
              [class.active]="currentShape === svg"
              (click)="selectShape.emit(svg)"
            >
              <div
                class="ff-gallery-preview mask-preview"
                [style.mask-image]="'url(/forms/' + svg + ')'"
                [style.-webkit-mask-image]="'url(/forms/' + svg + ')'"
              ></div>
            </div>
          }
        </div>
      </tab>

      <tab label="Imágenes" id="images">
        <div class="ff-object-gallery">
          @if (allowClear) {
            <div
              class="ff-gallery-item"
              [class.active]="!currentShape && allowClear"
              (click)="selectShape.emit(null)"
              title="Sin Objeto"
            >
              <div
                class="ff-gallery-preview mask-preview"
                style="mask-image: url(/icons/no-object.svg); -webkit-mask-image: url(/icons/no-object.svg);"
              ></div>
            </div>
          }

          @for (img of availableImages(); track img) {
            <div
              class="ff-gallery-item"
              [class.active]="currentShape === img"
              (click)="selectShape.emit(img)"
            >
              <div
                class="ff-gallery-preview image-preview"
                [style.background-image]="'url(/images/' + img + ')'"
              ></div>
            </div>
          }
        </div>
      </tab>
    </tabs>
  `,
  styles: [
    `
      .ff-object-gallery {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-bottom: 1.5rem;
        max-height: 300px;
        overflow-y: auto;
        padding-right: 4px;
      }
      .ff-gallery-item {
        aspect-ratio: 1;
        background: transparent;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        padding: 0.5rem;
        color: #64748b;
      }
      .ff-gallery-item:hover {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.05);
        transform: translateY(-2px);
      }
      .ff-gallery-item.active {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        color: #3b82f6;
      }
      .ff-gallery-preview {
        width: 100%;
        height: 100%;
        background-position: center;
        background-repeat: no-repeat;
        background-size: contain;
      }
      .mask-preview {
        background-color: currentColor; /* Only for mask-based SVG previews */
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        -webkit-mask-size: contain;
        -webkit-mask-repeat: no-repeat;
        -webkit-mask-position: center;
      }
      .image-preview {
        /* Full color image */
      }

      /* Scrollbar styling */
      .ff-object-gallery::-webkit-scrollbar {
        width: 4px;
      }
      .ff-object-gallery::-webkit-scrollbar-track {
        background: #f1f5f9;
      }
      .ff-object-gallery::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }
    `,
  ],
})
export class VisualObjectsTab {
  @Input() currentShape: string | null | undefined = null;
  @Input() allowClear = true;
  @Output() selectShape = new EventEmitter<string | null>();

  // Hardcoded for now based on file list, or could be passed as Input
  // Ideally these come from a service or constant
  availableForms = signal<string[]>([
    'isometric-cube.svg',
    'isometric-sphere.svg',
    'isometric-box.svg',
    'isometric-opa.cube.svg',
    'isometric-opa.cylinder.svg',
    'isometric-pyramid.svg',
    'isometric-cylinder.svg',
    'isometric-cone.svg',
    'isometric-prism.svg',
    'module-box.svg',
  ]);

  availableImages = signal<string[]>([
    'car.png',
    'code.png',
    'coffe.png',
    'database.png',
    'machine.png',
    'machine_01.png',
    'paper.png',
    'person.png',
    'person_02.png',
    'phone.png',
    'robot.png',
    'robot_03.png',
    'server.png',
    'server_01.png',
  ]);
}
