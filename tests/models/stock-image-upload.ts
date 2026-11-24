import { setup } from 'xstate';
import {
  adjacencyMapToArray,
  getAdjacencyMap,
  getPathsFromEvents,
  getSimplePaths,
} from 'xstate/graph';

type ImageEvent = {
  type:
    | 'deleteStock'
    | 'deleteProject'
    | 'beginReplacement'
    | 'completeOriginal'
    | 'completeReplacement'
    | 'replayReplacement'
    | 'cleanup';
};

const model = setup({ types: { events: {} as ImageEvent } }).createMachine({
  id: 'B14',
  initial: 'originalPending',
  states: {
    originalPending: { on: { deleteStock: 'parentDeleted', deleteProject: 'parentDeleted' } },
    parentDeleted: {
      tags: ['originalCleanupQueued'],
      on: { beginReplacement: 'bothPending' },
    },
    bothPending: {
      tags: ['originalCleanupQueued', 'replacementPending'],
      on: {
        completeOriginal: 'originalFinished',
        completeReplacement: 'replacementReady',
        replayReplacement: 'bothPending',
        cleanup: 'bothPending',
      },
    },
    originalFinished: {
      tags: ['replacementPending'],
      on: { completeReplacement: 'settled' },
    },
    replacementReady: {
      tags: ['originalCleanupQueued', 'replacementReady'],
      on: { completeOriginal: 'settled' },
    },
    settled: {
      tags: ['replacementReady'],
      on: { cleanup: 'settled', replayReplacement: 'settled' },
    },
  },
});

const loops = adjacencyMapToArray(getAdjacencyMap(model, {})).filter(
  ({ state, nextState }) => state.value === nextState.value,
);
const loopEvents = (name: 'bothPending' | 'settled') =>
  loops.filter(({ state }) => state.matches(name)).map(({ event }) => event);

export const stockImageUploadPaths = getSimplePaths(model, {
  toState: (state) => state.matches('settled'),
}).flatMap(({ steps }) => {
  const events = steps
    .slice(1)
    .flatMap(({ event, state }) =>
      state.matches('bothPending') ? [event, ...loopEvents('bothPending')] : [event],
    );
  return getPathsFromEvents(model, [...events, ...loopEvents('settled')]);
});
