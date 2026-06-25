import { setup } from 'xstate';

export type DefenseSignal = 'normal' | 'attention' | 'lockdown';

export const securityMachine = setup({
  types: {
    events: {} as
      | { type: 'RESET' }
      | { type: 'ATTENTION' }
      | { type: 'LOCKDOWN' },
  },
}).createMachine({
  id: 'friendconnect-security',
  initial: 'normal',
  states: {
    normal: {
      on: {
        ATTENTION: 'attention',
        LOCKDOWN: 'lockdown',
      },
    },
    attention: {
      on: {
        RESET: 'normal',
        LOCKDOWN: 'lockdown',
      },
    },
    lockdown: {
      on: {
        RESET: 'normal',
      },
    },
  },
});

export function getDefenseSignal(lockdownMode: boolean, openErrors: number, securityEvents: number): DefenseSignal {
  if (lockdownMode) {
    return 'lockdown';
  }

  if (openErrors > 0 || securityEvents > 0) {
    return 'attention';
  }

  return 'normal';
}
