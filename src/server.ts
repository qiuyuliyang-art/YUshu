import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { contentRouter } from './api/content.js';
import { publishRouter } from './api/publish.js';
import { statusRouter } from './api/status.js';
import { generateRouter } from './api/generate.js';
import { platformsRouter } from './api/platforms.js';
import { accountsRouter } from './api/accounts.js';

const app = express();

app.use(express.json());
app.use(express.static(path.resolve('public')));
app.use('/uploads', express.static(config.uploadDir));

app.use('/api/content', contentRouter);
app.use('/api/publish', publishRouter);
app.use('/api/generate', generateRouter);
app.use('/api/platforms', platformsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api', statusRouter);

app.listen(config.port, () => {
  console.log(`[server] Publish Platform running at http://localhost:${config.port}`);
});
