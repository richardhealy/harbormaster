import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'harbormaster', version: '0.1.0' });
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`harbormaster control plane running on :${PORT}`);
  });
}

export default app;
