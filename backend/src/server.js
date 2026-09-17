const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`Santulan backend listening on port ${config.port}`); // eslint-disable-line no-console
});
