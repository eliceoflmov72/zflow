import {
  Component,
  ContentChildren,
  QueryList,
  AfterContentInit,
  signal,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Tab } from './tab';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ff-tabs',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ff-tabs-container">
      <div class="ff-tabs-header">
        @for (tab of tabs; track tab.id) {
          <button
            class="ff-tab-btn"
            [class.active]="activeTabId() === tab.id"
            (click)="selectTab(tab)"
          >
            {{ tab.label }}
            @if (activeTabId() === tab.id) {
              <div class="active-indicator" layoutId="indicator"></div>
            }
          </button>
        }
      </div>
      <div class="ff-tabs-content">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      .ff-tabs-container {
        width: 100%;
      }
      .ff-tabs-header {
        display: flex;
        gap: 1rem;
        border-bottom: 1px solid #e2e8f0;
        margin-bottom: 0.5rem;
      }
      .ff-tab-btn {
        background: none;
        border: none;
        padding: 0.75rem 0.5rem;
        color: #64748b;
        font-weight: 500;
        font-size: 0.9rem;
        cursor: pointer;
        position: relative;
        transition: color 0.2s;
      }
      .ff-tab-btn:hover {
        color: #1e293b;
      }
      .ff-tab-btn.active {
        color: #3b82f6;
        font-weight: 600;
      }
      .active-indicator {
        position: absolute;
        bottom: -1px;
        left: 0;
        width: 100%;
        height: 2px;
        background-color: #3b82f6;
        border-radius: 2px 2px 0 0;
      }
    `,
  ],
})
export class Tabs implements AfterContentInit {
  @ContentChildren(Tab) tabs!: QueryList<Tab>;
  activeTabId = signal<string>('');

  ngAfterContentInit() {
    if (this.tabs && this.tabs.length > 0) {
      // Select first tab by default if none selected
      this.selectTab(this.tabs.first);
    }
  }

  selectTab(tab: Tab) {
    this.activeTabId.set(tab.id);
    this.tabs.forEach((t) => t.active.set(t.id === tab.id));
  }
}
