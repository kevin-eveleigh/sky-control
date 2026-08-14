export class MenuRebuildGate {
  constructor({ defer = queueMicrotask } = {}) {
    this.defer = defer;
    this.open = false;
    this.pending = false;
  }

  request(rebuild) {
    if (this.open) {
      this.pending = true;
      return false;
    }
    this.pending = false;
    rebuild();
    return true;
  }

  willShow() {
    this.open = true;
  }

  willClose(rebuild) {
    this.open = false;
    if (!this.pending) return false;
    this.pending = false;
    this.defer(() => this.request(rebuild));
    return true;
  }
}
