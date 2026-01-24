import { describe, it, expect, beforeEach } from 'vitest';
import { Mutex } from '../../../src/utils/mutex.js';

describe('Mutex', () => {
  let mutex: Mutex;

  beforeEach(() => {
    mutex = new Mutex();
  });

  it('should not be locked initially', () => {
    expect(mutex.isLocked()).toBe(false);
  });

  it('should be locked after acquiring', async () => {
    const release = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);
    release();
  });

  it('should be unlocked after releasing', async () => {
    const release = await mutex.acquire();
    release();
    expect(mutex.isLocked()).toBe(false);
  });

  it('should queue multiple acquirers', async () => {
    const order: number[] = [];

    const release1 = await mutex.acquire();
    order.push(1);

    // Start second acquire (will wait)
    const promise2 = mutex.acquire().then((release) => {
      order.push(2);
      return release;
    });

    // Start third acquire (will wait)
    const promise3 = mutex.acquire().then((release) => {
      order.push(3);
      return release;
    });

    // Release first lock
    release1();

    // Wait for second to acquire
    const release2 = await promise2;
    release2();

    // Wait for third to acquire
    const release3 = await promise3;
    release3();

    expect(order).toEqual([1, 2, 3]);
  });

  it('should handle concurrent acquire/release correctly', async () => {
    const results: string[] = [];

    const task = async (name: string): Promise<void> => {
      const release = await mutex.acquire();
      results.push(`${name}-start`);
      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      results.push(`${name}-end`);
      release();
    };

    await Promise.all([task('a'), task('b'), task('c')]);

    // Verify that operations don't interleave
    // Each task should complete before the next starts
    expect(results).toHaveLength(6);

    // Check that start-end pairs are consecutive for each task
    const startsAndEnds = results.reduce(
      (acc, item) => {
        const [name, phase] = item.split('-');
        if (name && phase) {
          if (phase === 'start') {
            acc.current = name;
          } else if (phase === 'end') {
            expect(acc.current).toBe(name);
            acc.current = null;
          }
        }
        return acc;
      },
      { current: null as string | null },
    );

    expect(startsAndEnds.current).toBeNull();
  });
});
