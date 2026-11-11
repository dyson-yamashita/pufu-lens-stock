import sparse from './pufu-sparse.json';

// Five purposes and thirteen measures with comments exceed the unscaled pixel budget.
const score = structuredClone(sparse);
score.purposes = [2, 3, 3, 3, 2].map((count, purposeIndex) => ({
  ...structuredClone(sparse.purposes[0]),
  uuid: `purpose-${purposeIndex}`,
  comment: { color: 'blue', text: '行動の結果を振り返り、次の改善につなげる' },
  measures: Array.from({ length: count }, (_, measureIndex) => ({
    ...structuredClone(sparse.purposes[0].measures[0]),
    uuid: `measure-${purposeIndex}-${measureIndex}`,
    text: '試した結果を記録して次の行動に活かす',
    comment: {
      color: 'blue',
      text: '利用者の反応を確認し、得られた気づきを次の改善につなげる',
    },
  })),
}));
export default score;
