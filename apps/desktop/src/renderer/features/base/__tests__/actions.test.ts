import { describe, expect, it } from 'vitest';
import { MASS_ACTIONS, massActionState } from '../actions';

const byId = (id: string) => {
  const action = MASS_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`no action ${id}`);
  return action;
};

const check = byId('check');
const cleanup = byId('cleanup');
const friends = byId('friends');

describe('MASS_ACTIONS', () => {
  it('names every action once', () => {
    expect(new Set(MASS_ACTIONS.map((a) => a.id)).size).toBe(MASS_ACTIONS.length);
  });

  it('gives every action at least one service to belong to', () => {
    for (const action of MASS_ACTIONS) expect(action.services.length).toBeGreaterThan(0);
  });

  // The whole point of the table: extending an operation to a second service is a word here, not a branch somewhere else.
  it('lets an action serve both services', () => {
    expect([...check.services].sort()).toEqual(['steam', 'telegram']);
  });
});

describe('massActionState', () => {
  // Nothing selected is not a mistake, so it gets no tooltip explaining one.
  it('disables without a reason when nothing is selected', () => {
    expect(massActionState(check, null, false)).toEqual({
      visible: true,
      enabled: false,
      reasonKey: null,
    });
  });

  it('disables everything on a mixed selection, whatever the action', () => {
    for (const action of MASS_ACTIONS) {
      expect(massActionState(action, 'telegram', true)).toEqual({
        visible: true,
        enabled: false,
        reasonKey: 'base.mixedServices',
      });
    }
  });

  it('enables an action for a service it lists', () => {
    expect(massActionState(check, 'steam', false)).toEqual({
      visible: true,
      enabled: true,
      reasonKey: null,
    });
    expect(massActionState(friends, 'steam', false)).toEqual({
      visible: true,
      enabled: true,
      reasonKey: null,
    });
    expect(massActionState(cleanup, 'telegram', false)).toEqual({
      visible: true,
      enabled: true,
      reasonKey: null,
    });
  });

  // The reason still names the service the button belongs to rather than the one it does not.
  it('hides a single-service action from the other service, and says whose it is', () => {
    expect(massActionState(cleanup, 'steam', false)).toEqual({
      visible: false,
      enabled: false,
      reasonKey: 'base.only.telegram',
    });
    expect(massActionState(friends, 'telegram', false)).toEqual({
      visible: false,
      enabled: false,
      reasonKey: 'base.only.steam',
    });
  });

  // Hiding is for «this service does not have this operation».
  it('hides nothing on an empty or mixed selection', () => {
    for (const action of MASS_ACTIONS) {
      expect(massActionState(action, null, false).visible).toBe(true);
      expect(massActionState(action, 'steam', true).visible).toBe(true);
    }
  });

  // A mixed selection is the user's to fix; "not yet" is not, so it wins.
  it('reports an unfinished action as unfinished before anything else', () => {
    const soon = { ...check, soon: true } as const;
    expect(massActionState(soon, 'telegram', false)).toEqual({
      visible: true,
      enabled: false,
      reasonKey: 'base.soon',
    });
    expect(massActionState(soon, null, false)).toEqual({
      visible: true,
      enabled: false,
      reasonKey: 'base.soon',
    });
    expect(massActionState(soon, 'telegram', true)).toEqual({
      visible: true,
      enabled: false,
      reasonKey: 'base.mixedServices',
    });
  });

  // Every service keeps something to press: hiding is per action.
  it('leaves every service at least one action to run', () => {
    for (const service of ['telegram', 'steam'] as const) {
      const shown = MASS_ACTIONS.filter((a) => massActionState(a, service, false).visible);
      expect(shown.length).toBeGreaterThan(0);
      for (const action of shown) expect(action.services).toContain(service);
    }
  });
});
