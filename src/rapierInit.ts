import RAPIER from "@dimforge/rapier3d-compat";
import { withSuppressedConsoleWarning } from "./consoleWarnings";

const RAPIER_COMPAT_INIT_WARNING = "using deprecated parameters for the initialization function; pass a single object instead";

export function initializeRapierCompat(): Promise<unknown> {
  return withSuppressedConsoleWarning(RAPIER_COMPAT_INIT_WARNING, () => RAPIER.init());
}
