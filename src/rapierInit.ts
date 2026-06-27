import RAPIER from "@dimforge/rapier3d-compat";

const RAPIER_COMPAT_INIT_WARNING = "using deprecated parameters for the initialization function; pass a single object instead";

export function initializeRapierCompat(): Promise<unknown> {
  const originalWarn = console.warn;
  const filteredWarn: typeof console.warn = (...args: unknown[]) => {
    if (args.length === 1 && args[0] === RAPIER_COMPAT_INIT_WARNING) {
      return;
    }
    originalWarn(...args);
  };

  console.warn = filteredWarn;
  try {
    return Promise.resolve(RAPIER.init()).finally(() => {
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
