export function withSuppressedConsoleWarning<T>(message: string, callback: () => Promise<T> | T): Promise<T> {
  const originalWarn = console.warn;
  const filteredWarn: typeof console.warn = (...args: unknown[]) => {
    if (args.length === 1 && args[0] === message) {
      return;
    }
    originalWarn(...args);
  };

  console.warn = filteredWarn;
  try {
    return Promise.resolve(callback()).finally(() => {
      if (console.warn === filteredWarn) {
        console.warn = originalWarn;
      }
    });
  } catch (error) {
    if (console.warn === filteredWarn) {
      console.warn = originalWarn;
    }
    throw error;
  }
}
