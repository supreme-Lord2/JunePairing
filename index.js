const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;
const root = __dirname;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/qr', require('./qr'));
app.use('/code', require('./pair'));

// Keep the old URL working while using the maintained single-page interface.
app.get('/pair', (_req, res) => res.redirect('/'));
app.get('/', (_req, res) => res.sendFile(path.join(root, 'main.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
