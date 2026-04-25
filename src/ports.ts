/**
 * Ports: side-effecting capabilities a Worker may need.
 * Workers are pure with respect to the event; anything non-deterministic or
 * I/O-bound goes through a port so tests can inject deterministic doubles.
 */
export interface Ports {
  now: () => Date;
  cycleId: () => string;
}

export const realPorts: Ports = {
  now: () => new Date(),
  cycleId: () => crypto.randomUUID(),
};
