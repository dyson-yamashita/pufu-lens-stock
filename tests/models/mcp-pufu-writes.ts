import { assign, setup, type SnapshotFrom } from 'xstate';
import {
  adjacencyMapToArray,
  getAdjacencyMap,
  getPathsFromEvents,
  getShortestPaths,
} from 'xstate/graph';

type WriteEvent = {
  type:
    | 'create'
    | 'resendCreate'
    | 'changeCreateTitle'
    | 'append'
    | 'resendFirstAppend'
    | 'changeFirstReason'
    | 'appendWithOldRevision'
    | 'updateWithOldRevision'
    | 'removeWriteScope'
    | 'markNotReady';
};

type WriteResult =
  | { kind: 'fixture' }
  | { kind: 'create' }
  | { kind: 'append'; phase: number; revision: number; created: boolean }
  | { kind: 'denied'; status: 403 | 409 };

// B04の逐次操作。未完成状態のフィクスチャでは局面とrevisionを別々に進める。
const model = setup({
  types: {
    events: {} as WriteEvent,
    context: {} as { phase: number; revision: number; result: WriteResult },
  },
  actions: {
    create: assign({ phase: 1, revision: 1, result: { kind: 'create' } }),
    replayCreate: assign({ result: { kind: 'create' } }),
    append: assign(({ context }) => {
      const phase = context.phase + 1;
      const revision = context.revision + 1;
      return { phase, revision, result: { kind: 'append', phase, revision, created: true } };
    }),
    replayFirstAppend: assign({
      result: { kind: 'append', phase: 2, revision: 2, created: false },
    }),
    conflict: assign({ result: { kind: 'denied', status: 409 } }),
    forbidden: assign({ result: { kind: 'denied', status: 403 } }),
    fixture: assign({ result: { kind: 'fixture' } }),
    markNotReady: assign({
      revision: ({ context }) => context.revision + 1,
      result: { kind: 'fixture' },
    }),
  },
}).createMachine({
  id: 'B04',
  initial: 'empty',
  context: { phase: 0, revision: 0, result: { kind: 'fixture' } },
  states: {
    empty: { on: { create: { target: 'firstPhase', actions: 'create' } } },
    firstPhase: {
      on: {
        resendCreate: { actions: 'replayCreate' },
        changeCreateTitle: { actions: 'conflict' },
        append: { target: 'secondPhase', actions: 'append' },
      },
    },
    secondPhase: {
      on: {
        resendFirstAppend: { actions: 'replayFirstAppend' },
        appendWithOldRevision: { actions: 'conflict' },
        updateWithOldRevision: { actions: 'conflict' },
        append: { target: 'thirdPhase', actions: 'append' },
        removeWriteScope: { target: 'withoutWriteScope', actions: 'fixture' },
      },
    },
    thirdPhase: {
      on: {
        resendFirstAppend: { actions: 'replayFirstAppend' },
        changeFirstReason: { actions: 'conflict' },
        appendWithOldRevision: { actions: 'conflict' },
        resendCreate: { actions: 'replayCreate' },
        markNotReady: { target: 'notReady', actions: 'markNotReady' },
      },
    },
    withoutWriteScope: {
      on: {
        resendFirstAppend: { actions: 'forbidden' },
        resendCreate: { actions: 'forbidden' },
      },
    },
    notReady: {
      on: {
        resendFirstAppend: { actions: 'replayFirstAppend' },
        append: { actions: 'conflict' },
      },
    },
  },
});

// 到達先の最短経路に、同じ状態へ戻る再送・拒否の遷移を追加する。
// 経路の再計算では結果も含む既定の直列化を使い、各イベント直後の期待値を得る。
const traversal = {
  serializeState: (state: SnapshotFrom<typeof model>) => state.value,
};
const loops = adjacencyMapToArray(getAdjacencyMap(model, traversal)).filter(
  ({ state, nextState }) => state.value === nextState.value,
);

export const b04Paths = getShortestPaths(model, traversal)
  .filter(({ weight }) => weight > 0)
  .flatMap(({ state, steps }) => {
    const prefix = steps.slice(1).map(({ event }) => event);
    const localEvents = loops
      .filter((edge) => edge.state.value === state.value)
      .map(({ event }) => event);
    return getPathsFromEvents(model, [...prefix, ...localEvents]);
  });
