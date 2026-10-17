// Only the current view can occupy the network queue. Cancel obsolete work.
export class TileQueue {
  constructor(limit = 6) {
    this.limit = limit;
    this.active = new Map();
    this.pending = [];
    this.closed = false;
  }
  replace(jobs) {
    if (this.closed) return;
    const wanted = new Set(jobs.map((job) => job.key));
    for (const [key, entry] of this.active)
      if (!wanted.has(key)) entry.controller.abort();
    this.pending = jobs
      .filter((job) => !this.active.has(job.key))
      .sort((a, b) => a.priority - b.priority);
    this.pump();
  }
  pump() {
    while (
      !this.closed &&
      this.active.size < this.limit &&
      this.pending.length
    ) {
      const job = this.pending.shift();
      if (this.active.has(job.key)) continue;
      const controller = new AbortController(),
        entry = { controller };
      this.active.set(job.key, entry);
      Promise.resolve()
        .then(() => job.run(controller.signal))
        .catch(() => {})
        .finally(() => {
          if (this.active.get(job.key) === entry) this.active.delete(job.key);
          this.pump();
        });
    }
  }
  dispose() {
    this.closed = true;
    this.pending = [];
    for (const entry of this.active.values()) entry.controller.abort();
  }
}
