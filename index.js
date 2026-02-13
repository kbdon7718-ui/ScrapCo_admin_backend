require('dotenv').config();

const express = require('express');
const cors = require('cors');

const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3007;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'scrapco-admin-backend' });
});

app.use('/api/admin', adminRouter);

app.use((err, req, res, next) => {
  console.log('Unexpected server error:', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`ScrapCo admin backend listening on http://localhost:${PORT}`);
});
