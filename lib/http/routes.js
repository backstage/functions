const express = require('express');
const morgan = require('morgan');

const Sandbox = require('@globocom/backstage-functions-sandbox');

const SchemaResponse = require('./SchemaResponse');
const HealthcheckRouter = require('./routers/HealthcheckRouter');
const SchemasRouter = require('./routers/SchemasRouter');
const StatusRouter = require('./routers/StatusRouter');
const DebugRouter = require('./routers/DebugRouter');
const FunctionsRouter = require('./routers/FunctionsRouter');
const RedisStorage = require('../domain/storage/redis');
const parseExposeEnv = require('../support/parseExposeEnv');
const config = require('../support/config');

const FunctionsRequest = require('./FunctionsRequest');

morgan.token('response-sectime', (req, res) => {
  /* eslint no-underscore-dangle: ["error", { "allow": ["_header", "_startAt"] }] */
  if (!res._header || !req._startAt) {
    return '';
  }
  const diff = process.hrtime(req._startAt);
  const secs = diff[0] + (diff[1] * 1e-9);
  return secs.toFixed(3);
});

const app = express();

app.use(morgan(config.log.morganFormat));
app.disable('x-powered-by');
app.enable('trust proxy');

app.set('memoryStorage', new RedisStorage());
app.set('sandbox', new Sandbox({
  env: parseExposeEnv(),
  globalModules: config.defaultGlobalModules,
  asyncTimeout: config.asyncTimeout,
  syncTimeout: config.syncTimeout,
}));

app.get('/', (req, res) => {
  const backstageRequest = new FunctionsRequest(req);

  new SchemaResponse(backstageRequest, res, 'root')
    .json({
      name: 'Backstage functions',
    });
});

app.use('/healthcheck', HealthcheckRouter);
app.use('/status', StatusRouter);
app.use('/_debug', DebugRouter);
app.use('/_schemas', SchemasRouter);
app.use('/functions', FunctionsRouter);


module.exports = app;
