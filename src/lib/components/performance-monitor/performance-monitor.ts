import { Component, Input, Signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'performance-monitor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './performance-monitor.html',
  styleUrl: './performance-monitor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceMonitorComponent {
  @Input({ required: true }) currentFps!: Signal<number>;
  @Input({ required: true }) currentQualityLevel!: Signal<string>;
  @Input({ required: true }) visibleNodesCount!: Signal<number>;
}
