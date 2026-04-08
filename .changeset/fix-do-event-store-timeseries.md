---
"@workkit/do": patch
---

- `createEventStore`: event key and sequence counter are now written in a
  single atomic `storage.transaction()` call, preventing a torn state if the
  Worker crashed between the two writes.
- `createTimeSeries`: storage reads/writes now use an internal
  `StoredTimeSeriesEntry` type (with `bucket: string`) instead of the public
  `TimeSeriesEntry` type (with `bucket: Date`), eliminating a silent type lie
  where the runtime value was a string but TypeScript believed it was a `Date`.
