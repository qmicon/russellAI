const dotenv = require('dotenv')
const redis = require('redis');
const assert = require('assert');
const config = require('./config.json');
const local_config = require('./local_config.json');

assert.strictEqual(typeof config, 'object', 'Configuration must be an object');
assert.strictEqual(typeof local_config, 'object', 'Configuration must be an object');
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_CLIENT_SECRET_TEST);

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
const endpointSecret = process.env.ENDPOINT_SECRET_TEST;

// Using Express
const app = require('express')();

// Use body-parser to retrieve the raw body as a buffer
const bodyParser = require('body-parser');

const fulfillOrder = async (payment_link_id, quantity) => {
  // also pass the total price paid and currency type from the event object to fulfillOrder function for mongoDB logging
  var app_id = await redisClient.hGet(config.redisPaymentToAppKey, payment_link_id)
  if(!app_id) {
    console.log("app-id not found for this payment", payment_link_id)
    //logging it in mongodb as well
    return
  }
  var payment_model = await redisClient.hGet(config.redisAppPaymentModel, app_id)
  if(!payment_model) {
    console.log("payment model not available for this app-id", app_id)
    //logging it in mongodb as well
    return
  }
  var payment_model_json = null
  try {
    payment_model_json = JSON.parse(payment_model)
  }
  catch(err) {
    console.log(`error while parsing the payment model: ${err}`)
    // logging it in mongodb as well
  }
  if(!payment_model_json) return
  if(payment_model_json.pricing_model === "credit_based") {

    if(payment_model_json.financing_model === "user_level") {
      var user_id = await redisClient.hGet(`${app_id}${local_config.redisSuffixUserLevelUserIDKey}`, payment_link_id)
      if(!user_id) {
        console.log(`user ID not found for this credit based, user level app: ${app_id} with payment link ID: ${payment_link_id}`)
        // logging it in mongodb as well
        return
      }
      var credits_left = parseInt(await redisClient.hGet(`${app_id}${local_config.redisSuffixUserLevelCreditsKey}`, user_id))
      if(credits_left)
      credits_left += quantity;
      else credits_left = quantity
      await redisClient.hSet(`${app_id}${local_config.redisSuffixUserLevelCreditsKey}`, user_id, credits_left)
      console.log("Fulfilling order", payment_link_id, quantity);
      // logging it in mongodb as well
    }

    else if(payment_model_json.financing_model === "app_level") {
      var credits_left = parseInt(await redisClient.hGet(`${app_id}${local_config.redisSuffixAppLevelKey}`, local_config.redisAppLevelCreditsField))
      if(credits_left)
      credits_left += quantity;
      else credits_left = quantity
      await redisClient.hSet(`${app_id}${local_config.redisSuffixAppLevelKey}`, local_config.redisAppLevelCreditsField, credits_left)
      console.log("Fulfilling order", payment_link_id, quantity);
      // logging it in mongodb as well
    }
  }
  else if(payment_model_json.pricing_model === "balance_based") {
    //TODO
    return
  }
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
    var quantity = lineItems.data[0].quantity
    var paymentLinkID = event.data.object.payment_link
    // Fulfill the purchase...
    await fulfillOrder(paymentLinkID, quantity)
  }

  response.status(200).end();
});

app.listen(4242, () => console.log('Running on port 4242'));