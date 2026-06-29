import * as http from 'http';
import { createApp } from '../src/server';

function get(
  app: ReturnType<typeof createApp>,
  path: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const port = addr.port;
      const req = http.get(`http://localhost:${port}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode ?? 500, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 500, body: {} });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
    });
  });
}

describe('GET /health', () => {
  it('returns 200 with service name', async () => {
    const app = createApp();
    const result = await get(app, '/health');
    expect(result.status).toBe(200);
    expect(result.body['status']).toBe('ok');
    expect(result.body['service']).toBe('harbormaster');
  });
});
