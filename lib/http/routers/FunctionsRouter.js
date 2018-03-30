const crypto = require('crypto');

const Router = require('express').Router;
const bodyParser = require('body-parser');
const Validator = require('jsonschema').Validator;

const functionRunHandler = require('./functionRunHandler');
const FunctionsRequest = require('../FunctionsRequest');
const SchemaResponse = require('../SchemaResponse');

const log = require('../../support/log');
const schemas = require('../../domain/schemas');
const Pipeline = require('../../domain/Pipeline');
const { StdoutLogStorage } = require('../../domain/LogStorage');

const router = new Router();
const { bodyParserLimit } = require('../../support/config');


function codeFileName(namespace, codeId) {
  return `${namespace}/${codeId}.js`;
}

router.get('/', async (req, res) => {
  const memoryStorage = req.app.get('memoryStorage');
  const page = parseInt(req.query.page || '1', 10);
  const perPage = parseInt(req.query.perPage || '10', 10);
  const functionsRequest = new FunctionsRequest(req);

  try {
    const list = await memoryStorage.listNamespaces(page, perPage);
    new SchemaResponse(functionsRequest, res, 'functions/list').json(list);
  } catch (err) {
    log.error(`Error listing namespaces and its functions: ${err}`);
    res.status(500).json({ error: err.message });
  }
});

router.all('/:namespace/:id*', (req, res, next) => {
  req.log = new StdoutLogStorage(req.params.namespace, req.params.id).console;
  next();
});

router.post('/:namespace/:id', bodyParser.json({ limit: bodyParserLimit }), async (req, res) => {
  const validationResult = new Validator().validate(req.body, schemas['functions/item']);
  const memoryStorage = req.app.get('memoryStorage');

  if (!validationResult.valid) {
    const error = 'Invalid instance';
    const details = validationResult.errors.map(e => e.toString());

    res.status(400).json({ error, details });
    return;
  }

  const namespace = req.params.namespace;
  const id = req.params.id;
  const {
    code,
    env,
  } = req.body;
  const sandbox = req.app.get('sandbox');
  const filename = codeFileName(namespace, id);
  const invalid = sandbox.testSyntaxError(filename, code, {
    console: new StdoutLogStorage(namespace, id).console,
  });

  if (invalid) {
    req.log.error(`Failed to post code: ${invalid.error}`);
    res.status(400).json(invalid);
    return;
  }

  const hash = crypto.createHash('sha1').update(code).digest('hex');
  const data = { id, code, hash };

  if (env) {
    data.env = env;
  }

  try {
    const result = await memoryStorage.postCode(namespace, id, data);
    const codeResult = result[0][1];
    const hashResult = result[1][1];

    // When code and hash are already saved
    // we respond with a 400 - Bad Request
    if (codeResult === 0 || hashResult === 0) {
      res.status(400).json({ error: `The key ${namespace}:${id} already exists` });
      return;
    }

    res.set({ ETag: data.hash });

    new SchemaResponse(new FunctionsRequest(req), res, 'functions/item').json(data);
  } catch (err) {
    req.log.error(`${err}`);
    req.log.error(`${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});


router.put('/:namespace/:id', bodyParser.json({ limit: bodyParserLimit }), async (req, res) => {
  const validationResult = new Validator().validate(req.body, schemas['functions/item']);
  const memoryStorage = req.app.get('memoryStorage');

  if (!validationResult.valid) {
    const error = 'Invalid instance';
    const details = validationResult.errors.map(e => e.toString());

    res.status(400).json({ error, details });
    return;
  }
  const {
    namespace,
    id,
  } = req.params;
  const {
    code,
    env,
    exposed,
  } = req.body;
  const filename = codeFileName(namespace, id);
  const sandbox = req.app.get('sandbox');

  const invalid = sandbox.testSyntaxError(filename, code, {
    console: new StdoutLogStorage(namespace, id).console,
  });
  if (invalid) {
    req.log.error(`Failed to post code: ${invalid.error}`);
    res.status(400).json(invalid);
    return;
  }

  const hash = crypto.createHash('sha1').update(code).digest('hex');
  const data = { id, code, hash };

  if (env) {
    data.env = env;
  }

  if (exposed !== undefined) {
    data.exposed = exposed;
  }

  try {
    await memoryStorage.putCode(namespace, id, data);
    res.set({ ETag: data.hash });

    const functionsRequest = new FunctionsRequest(req);
    new SchemaResponse(functionsRequest, res, 'functions/item').json(data);
  } catch (err) {
    log.error(`[${namespace}:${id}] ${err}`);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:namespace/:id/env/:env', bodyParser.json({ strict: false, limit: bodyParserLimit }), async (req, res) => {
  const validationResult = new Validator().validate(req.body, schemas['functions/env']);
  const memoryStorage = req.app.get('memoryStorage');

  if (!validationResult.valid) {
    const error = 'Invalid instance';
    const details = validationResult.errors.map(e => e.toString());

    res.status(400).json({ error, details });
    return;
  }

  const {
    namespace,
    id,
    env,
  } = req.params;

  try {
    await memoryStorage
      .putCodeEnviromentVariable(namespace, id, env, req.body);
    res.status(204).end();
  } catch (err) {
    log.error(`[${namespace}:${id}] Failed to set enviroment variable ${env}, error: ${err}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/:namespace/:id/env/:env', async (req, res) => {
  const {
    namespace,
    id,
    env,
  } = req.params;
  const memoryStorage = req.app.get('memoryStorage');

  try {
    await memoryStorage
      .deleteCodeEnviromentVariable(namespace, id, env);
    res.status(204).end();
  } catch (err) {
    log.error(`[${namespace}:${id}] Failed to unset enviroment variable ${env}, error: ${err}`);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/:namespace/:id', async (req, res) => {
  const {
    namespace,
    id,
  } = req.params;
  const memoryStorage = req.app.get('memoryStorage');

  try {
    const code = await memoryStorage.getCode(namespace, id);
    if (!code) {
      const error = 'Code not found';
      req.log.error(error);
      res.status(404).json({ error });
      return;
    }

    res.set({ ETag: code.hash });

    const functionsRequest = new FunctionsRequest(req);

    new SchemaResponse(functionsRequest, res, 'functions/item').json(code);
  } catch (err) {
    req.log.error(`${err}`);
    req.log.error(`${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});


router.delete('/:namespace/:id', async (req, res) => {
  const namespace = req.params.namespace;
  const id = req.params.id;
  const memoryStorage = req.app.get('memoryStorage');

  try {
    await memoryStorage.deleteCode(namespace, id);
    res.status(204).end();
  } catch (err) {
    req.log.error(`Failed to delete code id: ${err}`);
    res.status(500).json({ error: err.message });
  }
});


router.all(
  '/:namespace/:id/run',
  bodyParser.json({ limit: bodyParserLimit }),
  (req, res) => functionRunHandler(req, res, { exposed: false })
);


router.put('/pipeline', bodyParser.json({ limit: bodyParserLimit }), async (req, res) => {
  const memoryStorage = req.app.get('memoryStorage');
  const sandbox = req.app.get('sandbox');

  let { steps } = req.query;

  if (!steps) {
    res.status(400).json({ error: 'Pass step by querystring is required' });
    return;
  }
  steps = steps.map((step) => {
    const [namespace, id] = step.split('/', 2);
    return { namespace, id };
  });

  try {
    const codes = await memoryStorage.getCodesByCache(steps, {
      preCache: (code) => {
        const filename = codeFileName(code.namespace, code.id);
        code.script = sandbox.compileCode(filename, code.code);
        return code;
      },
    });

    for (let i = 0; i < codes.length; i += 1) {
      if (!codes[i]) {
        const { namespace, id } = steps[i];
        const e = new Error(`Code '${namespace}/${id}' is not found`);
        e.statusCode = 404;
        throw e;
      }
    }

    const result = await new Pipeline(sandbox, req, codes).run();

    res.set(result.headers);
    res.status(result.status);
    res.json(result.body);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
