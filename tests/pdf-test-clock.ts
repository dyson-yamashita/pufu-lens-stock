// PDFクライアントのテスト用bundleだけにesbuildで注入する時計。
// PDF専用Workerと本番コードのタイマーは置き換えない。
let now = 0;
let nextId = 0;
const timers = new Map<number, { deadline: number; fire: () => void }>();

export function setTimeout(callback: () => void, delay: number) {
  const id = ++nextId;
  // Promiseの継続は登録元リクエストで作り、別リクエストの時計操作からI/Oを実行しない。
  const ready = new Promise<void>((fire) => {
    timers.set(id, { deadline: now + delay, fire });
  });
  void ready.then(callback);
  return id;
}

export function clearTimeout(id: number | undefined) {
  if (id !== undefined) timers.delete(id);
}

export function advanceClock(milliseconds: number) {
  now += milliseconds;
  for (const [id, timer] of timers) {
    if (timer.deadline <= now) {
      timers.delete(id);
      timer.fire();
    }
  }
  return { now, deadlines: [...timers.values()].map(({ deadline }) => deadline) };
}
