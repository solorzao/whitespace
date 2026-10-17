// A hedged race: try the first attempt alone, bring in the others if it's slow or fails, and take
// the first good answer. The losers are cancelled through their AbortSignal.

import { errorMessage } from "./http";

export type Attempt<T> = { name: string; run: (signal: AbortSignal) => Promise<T> };

export type RaceOptions = {
  hedgeAfterMs: number; // start the other attempts if the first hasn't answered by then
  totalMs: number; // give up on all of them after this
  timeoutMessage: string;
};

export function hedgedRace<T>(attempts: Attempt<T>[], options: RaceOptions): Promise<{ value: T; name: string }> {
  const [first, ...rest] = attempts;
  const controllers = attempts.map(() => new AbortController());

  return new Promise((resolve, reject) => {
    const errors: string[] = [];
    let settled = false;
    let running = 0;
    let restStarted = false;

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      controllers.forEach((c) => c.abort());
      settle();
    };
    const failIfDone = () => {
      if (restStarted && running === 0) finish(() => reject(new Error(errors.join("; "))));
    };
    const start = (i: number) => {
      running++;
      attempts[i].run(controllers[i].signal).then(
        (value) => finish(() => resolve({ value, name: attempts[i].name })),
        (err) => {
          running--;
          if (settled) return;
          errors.push(`${attempts[i].name}: ${errorMessage(err)}`);
          // The first attempt failing fast is no reason to wait for the hedge timer.
          if (!restStarted) startRest();
          else failIfDone();
        },
      );
    };
    const startRest = () => {
      if (restStarted || settled) return;
      restStarted = true;
      rest.forEach((_, j) => start(j + 1));
      failIfDone();
    };

    // Declared last but only read from the callbacks above, which run after this.
    const hedgeTimer = setTimeout(startRest, options.hedgeAfterMs);
    const deadline = setTimeout(() => finish(() => reject(new Error(options.timeoutMessage))), options.totalMs);
    if (!first) return finish(() => reject(new Error("nothing to race")));
    start(0);
  });
}
