// Core factory
export { d1 } from './client'

// Types
export type {
  TypedD1,
  D1Options,
  D1RunResult,
  D1Meta,
  D1ExecResult,
  D1BatchResult,
  BoundStatement,
  TypedPreparedStatement,
  ColumnTransformer,
  WhereCondition,
  WhereOperator,
  OrderDirection,
  SelectBuilder,
  InsertBuilder,
  UpdateBuilder,
  DeleteBuilder,
  ReturningBuilder,
  OnConflictAction,
} from './types'

// Errors
export {
  D1Error,
  D1QueryError,
  D1ConstraintError,
  D1BatchError,
  D1MigrationError,
  classifyD1Error,
} from './errors'

// Utilities
export { snakeToCamel } from './result'
