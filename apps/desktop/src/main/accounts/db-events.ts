type Listener = () => void;

const listeners = new Set<Listener>();

export const onDbRelocated = (fn: Listener): void => {
  listeners.add(fn);
};

export const emitDbRelocated = (): void => {
  for (const fn of listeners) fn();
};
