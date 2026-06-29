import { getPool, closePool } from '../../src/db/client';

describe('db/client', () => {
  afterAll(async () => {
    await closePool();
  });

  test('getPool returns a Pool instance', () => {
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });

  test('getPool returns the same singleton on repeated calls', () => {
    const a = getPool();
    const b = getPool();
    expect(a).toBe(b);
  });

  test('closePool clears the singleton so getPool returns a new pool', async () => {
    const a = getPool();
    await closePool();
    const b = getPool();
    expect(a).not.toBe(b);
  });
});
