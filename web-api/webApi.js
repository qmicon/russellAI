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
      console.log('/stripe/app_payment_model executed')
      res.json('/stripe/app_payment_model executed');
    } catch (error) {
      console.log('/stripe/app_payment_model', error)
      res.status(500).json({error: error.stack});
    }
});

app.use('/api', verifyToken, apiRouter);

app.listen(3292, () => console.log('Web API running on port 3292'));