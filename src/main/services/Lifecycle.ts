export class Lifecycle {
  private stops: Array<() => void> = [];

  register(stop: () => void): void {
    this.stops.push(stop);
  }

  stopAll(): void {
    for (const stop of this.stops) {
      try { stop(); } catch { /* best-effort shutdown */ }
    }
    this.stops = [];
  }
}
