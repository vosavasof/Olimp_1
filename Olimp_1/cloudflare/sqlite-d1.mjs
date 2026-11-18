import { DatabaseSync } from 'node:sqlite';

// The classroom API uses the same prepared-query interface on both hosts.
export class SqliteD1 {
  constructor(filename) {
    this.connection = new DatabaseSync(filename);
    this.connection.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.queries = 0;
  }
  execute(query) {
    this.queries++;
    const statement = this.connection.prepare(query.sql);
    if (statement.columns().length) return { results: statement.all(...query.args), success: true, meta: {} };
    const result = statement.run(...query.args);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  prepare(sql) {
    const database = this;
    return { sql, args: [], bind(...args) { return { ...this, args }; },
      async all() { return database.execute(this); },
      async first() { return (await this.all()).results[0] ?? null; },
      async run() { return database.execute(this); } };
  }
  async batch(queries) {
    this.connection.exec('BEGIN IMMEDIATE');
    try { const results = queries.map(query => this.execute(query)); this.connection.exec('COMMIT'); return results; }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  close() { this.connection.close(); }
}
