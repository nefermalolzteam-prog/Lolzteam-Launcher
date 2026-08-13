type Listener = (accountId: number) => void;

const listeners = new Set<Listener>();

export const onGuardRecordDropped = (fn: Listener): void => {
  listeners.add(fn);
};

export const emitGuardRecordDropped = (accountId: number): void => {
  for (const fn of listeners) fn(accountId);
};
