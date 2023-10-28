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
const app = require('express')();

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

app.use(verifyToken)

app.get('/ping', (req, res) => {
    console.log("API called")
    res.json({ message: 'Server is up and running' });
  });

app.listen(3292, () => console.log('Web API running on port 3292'));