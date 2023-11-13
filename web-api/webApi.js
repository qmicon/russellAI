const dotenv = require('dotenv')
const redis = require('redis');
const assert = require('assert');
const config = require('./config.json');
const local_config = require('./local_config.json');

assert.strictEqual(typeof config, 'object', 'Configuration must be an object');
assert.strictEqual(typeof local_config, 'object', 'Configuration must be an object');
dotenv.config();

const redisClient = redis.createClient({
    socket: {
        host: process.env.SERVER_IP,
        port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD
});

redisClient.on('error', err => console.log('Redis Server Error', err));

redisClient.connect().then(() => console.log("redis connected"));

// Using Express
const express = require('express');
const bodyParser = require('body-parser');
const Joi = require('joi');
const app = express();
const apiRouter = express.Router();

const verifyToken = (req, res, next) => {
    // Get the authorization header
    const authHeader = req.headers['authorization'];
  
    if (authHeader) {
      // Split the header to get the token part
      const token = authHeader.split(' ')[1];
  
      // TODO Future Scope: Verify the token (you can use a library like jsonwebtoken for more advanced token validation)
      if (token === process.env.WEB_API_BEARER_TOKEN) {
        // Token is valid, proceed to the next middleware or route
        next();
      } else {
        console.error('Invalid token');
        res.status(403).json({ error: 'Invalid token' });
      }
    } else {
      console.error('Authorization header is missing');
      res.status(401).json({ error: 'Authorization header is missing' });
    }
  };

apiRouter.get('/ping', (req, res) => {
    console.log("API called")
    res.json({ message: 'Server is up and running' });
  });


const appPaymentBodySchema = Joi.object({
  financing_model: Joi.string().valid('user_level', 'app_level').required(),
  pricing_model: Joi.string().valid('credit_based', 'balance_based')
})
apiRouter.post('/stripe/app_payment_model', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const payload = req.body.toString();
    const params = req.query;
    console.log(params)
    try {
      let body = JSON.parse(payload)
      console.log("body", body)
      const { error } = appPaymentBodySchema.validate(body, { abortEarly: false });

      if (error) {
        // Handling error due to incorrect data
        const errorMessage = error.details.map(detail => detail.message);
        console.log(errorMessage)
        return res.status(400).json({ error: errorMessage });
      }
      console.log("appId", params.app_id)
      let pricing_model = 'credit_based'
      if('pricing_model' in body) 
      pricing_model = body.pricing_model;
      body = {...body, pricing_model: pricing_model}
      await redisClient.hSet(config.redisAppPaymentModel, params.app_id, JSON.stringify(body))
      console.log('POST /stripe/app_payment_model executed')
      res.json('/stripe/app_payment_model executed');
    } catch (error) {
      console.log('POST /stripe/app_payment_model', error)
      res.status(500).json({error: error.stack});
    }
});

apiRouter.get('/stripe/app_payment_model',  async (req, res) =>{
  const params = req.query;
  console.log(params)
  try {
    if('app_id' in params) {
      let redisJsonVal = await redisClient.hGet(config.redisAppPaymentModel, params.app_id);
      console.log(`GET /stripe/app_payment_model?app_id=${params.app_id}`, JSON.parse(redisJsonVal))
      res.json({payment_model: JSON.parse(redisJsonVal)})
    }
    else {
      let redisJsonVal = await redisClient.hGetAll(config.redisAppPaymentModel)
      for(const key in redisJsonVal) {
        redisJsonVal[key] = JSON.parse(redisJsonVal[key])
      }
      console.log('GET /stripe/app_payment_model', redisJsonVal)
      res.json({app_list: redisJsonVal})
    }
  } catch (error) {
    console.log('GET /stripe/app_payment_model', error)
    res.status(500).json({error: error.stack});
  }
})

const currencyCodes = require('currency-codes');
const currencyDetailsBodySchema = Joi.object({
  name: Joi.string().required(),
  stripe_price_id: Joi.string().regex(/^price_[A-Za-z0-9]{24}$/).required()
})
apiRouter.post('/aiversion_discord_beta/currency', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  const params = req.query;
  console.log(params)
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    const { error } = currencyDetailsBodySchema.validate(body, { abortEarly: false });

    if (error) {
      // Handling error due to incorrect data
      const errorMessage = error.details.map(detail => detail.message);
      console.log(errorMessage)
      return res.status(400).json({ error: errorMessage });
    }
    console.log("currency-symbol", params.symbol)
    const isValidCurrencyCode = currencyCodes.codes().includes(params.symbol)
    if(! isValidCurrencyCode) {
      console.log(`${params.symbol} is not a valid ISO 4217 currency code`)
      return res.status(400).send(`${params.symbol} is not a valid ISO 4217 currency code\nProvide a valid symbol param`);
    }
    await redisClient.hSet(config.redisCurrencyDetailsKey, params.symbol, JSON.stringify(body))
    console.log('POST /aiversion_discord_beta/currency executed')
    res.json('/aiversion_discord_beta/currency executed');
  } catch (error) {
    console.log('POST /aiversion_discord_beta/currency', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.get('/aiversion_discord_beta/currency',  async (req, res) =>{
  const params = req.query;
  console.log(params)
  try {
    if('symbol' in params) {
      let redisJsonVal = await redisClient.hGet(config.redisCurrencyDetailsKey, params.symbol);
      console.log(`GET /aiversion_discord_beta/currency?symbol=${params.symbol}`, JSON.parse(redisJsonVal))
      res.json({currency_details: JSON.parse(redisJsonVal)})
    }
    else {
      let redisJsonVal = await redisClient.hGetAll(config.redisCurrencyDetailsKey)
      for(const key in redisJsonVal) {
        redisJsonVal[key] = JSON.parse(redisJsonVal[key])
      }
      console.log('GET /aiversion_discord_beta/currency', redisJsonVal)
      res.json({currency_list: redisJsonVal})
    }
  } catch (error) {
    console.log('GET /aiversion_discord_beta/currency', error)
    res.status(500).json({error: error.stack});
  }
})

const whiteListUserBodySchema = Joi.object({
  username: Joi.string().required()
})
apiRouter.post('/aiversion_discord_beta/whitelist_user', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  const params = req.query;
  console.log(params)
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    const { error } = whiteListUserBodySchema.validate(body, { abortEarly: false });

    if (error) {
      // Handling error due to incorrect data
      const errorMessage = error.details.map(detail => detail.message);
      console.log(errorMessage)
      return res.status(400).json({ error: errorMessage });
    }
    console.log("user-id", params.user_id)
    const discordIdRegex = /^[0-9]{18}$/
    if(! discordIdRegex.test(params.user_id)) {
      console.log(`${params.user_id} is not a valid discord user id`)
      return res.status(400).send(`${params.user_id} is not a valid discord user id\nProvide a valid user_id param`);
    }
    body = {...body, "is_whitelisted": true}
    await redisClient.hSet(config.redisWhitelistedUsersKey, params.user_id, JSON.stringify(body))
    console.log('POST /aiversion_discord_beta/whitelist_user executed')
    res.json('/aiversion_discord_beta/whitelist_user executed');
  } catch (error) {
    console.log('POST /aiversion_discord_beta/whitelist_user', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.delete('/aiversion_discord_beta/whitelist_user', async (req, res) => {
  const params = req.query;
  console.log(params)
  try {
    let redisJsonVal = await redisClient.hGet(config.redisWhitelistedUsersKey, params.user_id);
    redisJsonVal = JSON.parse(redisJsonVal)
    redisJsonVal.is_whitelisted = false
    await redisClient.hSet(config.redisWhitelistedUsersKey, params.user_id, JSON.stringify(redisJsonVal))
    console.log('DELETE /aiversion_discord_beta/whitelist_user executed')
    res.json('/aiversion_discord_beta/whitelist_user executed');
  } catch (error) {
    console.log('DELETE /aiversion_discord_beta/whitelist_user', error)
    res.status(500).json({error: error.stack});
  }
})

apiRouter.get('/aiversion_discord_beta/whitelist_user',  async (req, res) =>{
  const params = req.query;
  console.log(params)
  try {
    if('user_id' in params) {
      let redisJsonVal = await redisClient.hGet(config.redisWhitelistedUsersKey, params.user_id);
      console.log(`GET /aiversion_discord_beta/whitelist_user?user_id=${params.user_id}`, JSON.parse(redisJsonVal))
      res.json({user: JSON.parse(redisJsonVal)})
    }
    else {
      let redisJsonVal = await redisClient.hGetAll(config.redisWhitelistedUsersKey)
      for(const key in redisJsonVal) {
        redisJsonVal[key] = JSON.parse(redisJsonVal[key])
      }
      console.log('GET /aiversion_discord_beta/whitelist_user', redisJsonVal)
      res.json({user_list: redisJsonVal})
    }
  } catch (error) {
    console.log('GET /aiversion_discord_beta/whitelist_user', error)
    res.status(500).json({error: error.stack});
  }
})

const envModeBodySchema = Joi.object({
  mode: Joi.string().valid('test', 'live').required()
})
apiRouter.post('/aiversion_discord_beta/env_mode', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    const { error } = envModeBodySchema.validate(body, { abortEarly: false });

    if (error) {
      // Handling error due to incorrect data
      const errorMessage = error.details.map(detail => detail.message);
      console.log(errorMessage)
      return res.status(400).json({ error: errorMessage });
    }

    await redisClient.hSet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.envMode, body.mode)
    console.log('POST /aiversion_discord_beta/env_mode executed')
    res.json('/aiversion_discord_beta/env_mode executed');
  } catch (error) {
    console.log('POST /aiversion_discord_beta/env_mode', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.get('/aiversion_discord_beta/env_mode',  async (req, res) =>{
  try {
    let redisJsonVal = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.envMode);
    console.log('GET /aiversion_discord_beta/env_mode', redisJsonVal)
    res.json({mode: redisJsonVal}) 
  } catch (error) {
    console.log('GET /aiversion_discord_beta/env_mode', error)
    res.status(500).json({error: error.stack});
  }
})

const voiceNoteSwitchBodySchema = Joi.object({
  default_value: Joi.string().valid('on', 'off').required()
})
apiRouter.post('/aiversion_discord_beta/default_voice_note_switch', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    const { error } = voiceNoteSwitchBodySchema.validate(body, { abortEarly: false });

    if (error) {
      // Handling error due to incorrect data
      const errorMessage = error.details.map(detail => detail.message);
      console.log(errorMessage)
      return res.status(400).json({ error: errorMessage });
    }

    await redisClient.hSet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.defaultVoiceNoteSwitch, body.default_value)
    console.log('POST /aiversion_discord_beta/default_voice_note_switch executed')
    res.json('/aiversion_discord_beta/default_voice_note_switch executed');
  } catch (error) {
    console.log('POST /aiversion_discord_beta/default_voice_note_switch', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.get('/aiversion_discord_beta/default_voice_note_switch',  async (req, res) =>{
  try {
    let redisJsonVal = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.defaultVoiceNoteSwitch);
    console.log('GET /aiversion_discord_beta/default_voice_note_switch', redisJsonVal)
    res.json({default_value: redisJsonVal}) 
  } catch (error) {
    console.log('GET /aiversion_discord_beta/default_voice_note_switch', error)
    res.status(500).json({error: error.stack});
  }
})

const freeTextCreditsBodySchema = Joi.object({
  default_value: Joi.number().integer().min(0).required()
})
apiRouter.post('/aiversion_discord_beta/free_text_credits', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    const { error } = freeTextCreditsBodySchema.validate(body, { abortEarly: false });

    if (error) {
      // Handling error due to incorrect data
      const errorMessage = error.details.map(detail => detail.message);
      console.log(errorMessage)
      return res.status(400).json({ error: errorMessage });
    }

    await redisClient.hSet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.freeTextCredits, body.default_value)
    console.log('POST /aiversion_discord_beta/free_text_credits executed')
    res.json('/aiversion_discord_beta/free_text_credits executed');
  } catch (error) {
    console.log('POST /aiversion_discord_beta/free_text_credits', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.get('/aiversion_discord_beta/free_text_credits',  async (req, res) =>{
  try {
    let redisJsonVal = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.freeTextCredits);
    console.log('GET /aiversion_discord_beta/free_text_credits', redisJsonVal)
    res.json({default_value: redisJsonVal}) 
  } catch (error) {
    console.log('GET /aiversion_discord_beta/free_text_credits', error)
    res.status(500).json({error: error.stack});
  }
})


// TODO: add enum validation in POST body
apiRouter.post('/runpod/price', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    for(const key in body) {
      if(Number.isFinite(body[key]))
      await redisClient.hSet(config.redisGlobalStatesKey, `runpod-${key}${config.redisGlobalStatesFields.priceSuffix}`, body[key])
    }
    console.log('POST /runpod/price executed')
    res.json('/runpod/price executed');
  } catch (error) {
    console.log('POST /runpod/price', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.get('/runpod/price',  async (req, res) =>{
  try {
    let redisJsonVal = await redisClient.hGetAll(config.redisGlobalStatesKey);
    const pattern = new RegExp(`^runpod-.*${config.redisGlobalStatesFields.priceSuffix}$`);
    const matchPattern = new RegExp(`^runpod-(.*)${config.redisGlobalStatesFields.priceSuffix}$`)
    var returnVal = {}
    for(const key in redisJsonVal) {
      if(pattern.test(key))
      returnVal[key.match(matchPattern)[1]] = parseFloat(redisJsonVal[key])
    }
    console.log('GET /runpod/price', returnVal)
    res.json({dollars_per_second_usage: returnVal}) 
  } catch (error) {
    console.log('GET /runpod/price', error)
    res.status(500).json({error: error.stack});
  }
})

// TODO: add enum validation in POST body
apiRouter.post('/openai/price', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body.toString();
  try {
    let body = JSON.parse(payload)
    console.log("body", body)
    for(const key in body) {
      if(Number.isFinite(body[key]))
      await redisClient.hSet(config.redisGlobalStatesKey, `openai-${key}${config.redisGlobalStatesFields.priceSuffix}`, body[key])
    }
    console.log('POST /openai/price executed')
    res.json('/openai/price executed');
  } catch (error) {
    console.log('POST /openai/price', error)
    res.status(500).json({error: error.stack});
  }
});

apiRouter.get('/openai/price',  async (req, res) =>{
  try {
    let redisJsonVal = await redisClient.hGetAll(config.redisGlobalStatesKey);
    const pattern = new RegExp(`^openai-.*${config.redisGlobalStatesFields.priceSuffix}$`);
    const matchPattern = new RegExp(`^openai-(.*)${config.redisGlobalStatesFields.priceSuffix}$`)
    var returnVal = {}
    for(const key in redisJsonVal) {
      if(pattern.test(key))
      returnVal[key.match(matchPattern)[1]] = parseFloat(redisJsonVal[key])
    }
    console.log('GET /openai/price', returnVal)
    res.json({dollars_per_1k_tokens_usage: returnVal}) 
  } catch (error) {
    console.log('GET /openai/price', error)
    res.status(500).json({error: error.stack});
  }
})

// TODO: Log the changes of POST/DELETE in mongoDB to maintain history of changes
app.use('/api', verifyToken, apiRouter);

app.listen(3292, () => console.log('Web API running on port 3292'));