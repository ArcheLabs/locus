export type LocusMode = "demo" | "network";

/** Demo is opt-in for dev previews; every other value resolves to Network. */
export function resolveLocusMode(value: string | undefined): LocusMode {
  return value === "demo" ? "demo" : "network";
}

/** Production builds are always Network Mode, even if a shell exports demo. */
export function buildLocusMode(value: string | undefined, command: "serve" | "build"): LocusMode {
  return command === "build" ? "network" : resolveLocusMode(value);
}
