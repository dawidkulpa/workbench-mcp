/**
 * A simple mutex implementation for per-conversation locking.
 * Ensures only one operation can run per conversation at a time.
 */
export class Mutex {
  private locked = false;
  private queue: Array<(release: () => void) => void> = [];

  /**
   * Acquire the lock. Returns a release function to be called when done.
   */
  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        this.queue.push(resolve);
      }
    });
  }

  /**
   * Release the lock and process the next waiting acquirer.
   */
  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Pass release function to the next waiter
      next(() => this.release());
    } else {
      this.locked = false;
    }
  }

  /**
   * Check if the mutex is currently locked.
   */
  isLocked(): boolean {
    return this.locked;
  }
}
