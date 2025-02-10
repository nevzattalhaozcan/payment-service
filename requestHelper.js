const crypto = require('crypto');

const createIyzicoRequestConfig = (uriPath, requestBody) => {
  console.log('Creating Iyzico config for path:', uriPath);

  const apiKey = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('Iyzico API key or secret key is missing');
  }

  const randomString = crypto.randomBytes(8).toString('hex');
  const timestamp = Date.now().toString();

  const payload = `${apiKey}${randomString}${timestamp}${requestBody}`;
  const hash = crypto.createHmac('sha256', secretKey).update(payload).digest('base64');

  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `IYZWS ${apiKey}:${hash}`,
      'x-iyzi-rnd': randomString,
      'x-iyzi-client-version': 'payment-service-node-1.0',
    },
  };
};

module.exports = { createIyzicoRequestConfig };
