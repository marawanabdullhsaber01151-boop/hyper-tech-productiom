/**
 * Loose structural type shared by helpers that run both on `db` and inside a
 * drizzle `db.transaction(tx => ...)` callback (where `tx` is not exactly
 * `typeof db`). One definition, used everywhere — do not redeclare it.
 */
export type Executor = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  execute: (...args: any[]) => Promise<any>;
};
