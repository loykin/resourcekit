import { DatabaseSync } from 'node:sqlite'

/**
 * A tiny in-memory SQLite database, purely to demonstrate that
 * `ConnectionAdapter` isn't REST-specific — a host can write its own adapter
 * for whatever backend it actually has (see sqlite-connection-adapter.ts).
 * Uses Node's built-in `node:sqlite`, so this needs no extra dependency.
 */
export interface DemoDb {
  db: DatabaseSync
  tables: string[]
}

export function startDemoDb(): DemoDb {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL
    )
  `)
  const insert = db.prepare('INSERT INTO orders (id, customer, amount, status) VALUES (?, ?, ?, ?)')
  insert.run('1', 'Alice Kim', 120.5, 'paid')
  insert.run('2', 'Bob Martinez', 45.0, 'pending')
  insert.run('3', 'Carla Chen', 300.0, 'paid')
  insert.run('4', 'David Osei', 75.25, 'refunded')

  return { db, tables: ['orders'] }
}
