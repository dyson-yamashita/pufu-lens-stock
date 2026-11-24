import { setup } from 'xstate';
import {
  adjacencyMapToArray,
  getAdjacencyMap,
  getPathsFromEvents,
  getSimplePaths,
} from 'xstate/graph';

type SummaryEvent = {
  type: 'editText' | 'completeOriginal' | 'completeCurrent' | 'redeliverCurrent';
};

const model = setup({ types: { events: {} as SummaryEvent } }).createMachine({
  id: 'B08',
  initial: 'originalAtCommit',
  states: {
    originalAtCommit: { on: { editText: 'currentQueued' } },
    currentQueued: {
      on: { completeOriginal: 'originalFinished', completeCurrent: 'currentReady' },
    },
    originalFinished: {
      tags: ['originalFinished'],
      on: { completeCurrent: 'settled' },
    },
    currentReady: {
      tags: ['summaryReady'],
      on: { completeOriginal: 'settled' },
    },
    settled: {
      tags: ['originalFinished', 'summaryReady'],
      on: { redeliverCurrent: 'settled' },
    },
  },
});

const replayEvents = adjacencyMapToArray(getAdjacencyMap(model, {}))
  .filter(({ state, nextState }) => state.matches('settled') && nextState.matches('settled'))
  .map(({ event }) => event);

// 同じ完了状態への両経路を通し、完了後の再配送も加える。
export const articleSummaryPaths = getSimplePaths(model, {
  toState: (state) => state.matches('settled'),
}).flatMap(({ steps }) =>
  getPathsFromEvents(model, [...steps.slice(1).map(({ event }) => event), ...replayEvents]),
);
