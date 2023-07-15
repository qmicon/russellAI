const dotenv = require('dotenv')
const redis = require('redis');
const assert = require('assert');
const config = require('./config.json');

assert.strictEqual(typeof config, 'object', 'Configuration must be an object');
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_CLIENT_SECRET);

const redisClient = redis.createClient({
    socket: {
        host: process.env.SERVER_IP,
        port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD
});

redisClient.on('error', err => console.log('Redis Server Error', err));

redisClient.connect().then(() => console.log("redis connected"));

// Find your endpoint's secret in your Dashboard's webhook settings
const endpointSecret = process.env.ENDPOINT_SECRET;

// Using Express
const app = require('express')();

// Use body-parser to retrieve the raw body as a buffer
const bodyParser = require('body-parser');

const fulfillOrder = async (payment_link_id, quantity) => {
  var user_id = await redisClient.hGet(config.redisPaymentKey, payment_link_id)
  var credits_left = parseInt(await redisClient.hGet(config.redisCreditsKey, user_id))
  credits_left += quantity*5;
  await redisClient.hSet(config.redisCreditsKey, user_id, credits_left)
  console.log("Fulfilling order", payment_link_id, quantity);
}

app.post('/webhook', bodyParser.raw({type: 'application/json'}), async (request, response) => {
  const payload = request.body;
  const sig = request.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(payload, sig, endpointSecret);
  } catch (err) {
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }
  console.log(event.type)
  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    // Retrieve the session. If you require line items in the response, you may include them by expanding line_items.
    const sessionWithLineItems = await stripe.checkout.sessions.retrieve(
      event.data.object.id,
      {
        expand: ['line_items'],
      }
    );
    const lineItems = sessionWithLineItems.line_items;
    var quantity = lineItems[0].quantity
    var paymentLinkID = event.data.payment_link
    // Fulfill the purchase...
    await fulfillOrder(paymentLinkID, quantity)
  }

  response.status(200).end();
});

app.listen(4242, () => console.log('Running on port 4242'));