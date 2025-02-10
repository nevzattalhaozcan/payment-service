const crypto = require('crypto');
require('dotenv').config();

const API_KEY = process.env.IYZICO_API_KEY;
const SECRET_KEY = process.env.IYZICO_SECRET_KEY;

if (!API_KEY || !SECRET_KEY) {
  throw new Error('API_KEY and SECRET_KEY must be defined in environment variables');
}

function generateAuthorizationString(uriPath, requestBody, randomKey) {
  if (!uriPath) {
    throw new Error('uriPath is required');
  }

  if (!randomKey) {
    throw new Error('randomKey is required');
  }
  
  const payload = randomKey + uriPath + JSON.stringify(requestBody || {});
  
  const encryptedData = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
  
  const authorizationString = `apiKey:${API_KEY}&randomKey:${randomKey}&signature:${encryptedData}`;
  
  const base64EncodedAuthorization = Buffer.from(authorizationString).toString('base64');
  
  return `IYZWSv2 ${base64EncodedAuthorization}`;
}

function createIyzicoRequestConfig(uriPath, body) {
    const randomString = Date.now().toString();
    const authorization = generateAuthorizationString(uriPath, body, randomString);

    return {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authorization,
            'x-iyzi-rnd': randomString
        }
    };
}

module.exports = { createIyzicoRequestConfig };