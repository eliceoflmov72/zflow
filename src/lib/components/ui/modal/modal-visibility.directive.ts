import { Directive, HostBinding, Input } from '@angular/core';

@Directive({
  selector: '[modalVisibility]',
  standalone: true,
})
export class ModalVisibilityDirective {
  @Input() isVisible = false;

  @HostBinding('style.display') get display() {
    return this.isVisible ? 'contents' : 'none';
  }
}
