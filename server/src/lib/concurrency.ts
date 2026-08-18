/** Chạy tối đa `limit` task đồng thời (hàng đợi FIFO) - chống quá tải AI API / Google API khi xử lý hàng loạt. */
export function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  }

  return { run };
}