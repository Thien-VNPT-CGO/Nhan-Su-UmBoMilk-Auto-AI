/** Gom nhiều sự kiện (socket, interval...) thành 1 lần gọi API duy nhất để tránh reload liên tục. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (t) {
      clearTimeout(t);
      t = null;
    }
  };
  return wrapped;
}