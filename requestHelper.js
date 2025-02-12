const crypto = require('crypto');
require('dotenv').config();
const { pool } = require('./db');

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

function validateSignature(payload, signatureHeader) {
  const secretKey = process.env.IYZICO_SECRET_KEY;

  const keyString = secretKey +
    payload.iyziEventType +
    payload.iyziPaymentId +
    payload.paymentConversationId +
    payload.status;

  const generatedSignature = crypto.createHmac('sha256', secretKey)
    .update(keyString)
    .digest('hex');  

  return generatedSignature === signatureHeader;
}

async function updateOrderStatus(paymentConversationId, status) {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE payment_conversation_id = $1', [paymentConversationId]);
    const payment = result.rows[0];
    if (!payment) {
      console.log('Sipariş bulunamadı!');
      return;
    }

    const newStatus = status === 'SUCCESS' ? 'completed' : 'failed';
    await pool.query('UPDATE payments SET status = $1 WHERE payment_conversation_id = $2', [newStatus, paymentConversationId]);

    console.log(`Sipariş durumu güncellendi: ${newStatus}`);
  } catch (error) {
    console.error('Sipariş güncellenirken hata oluştu:', error);
  }
}

module.exports = { createIyzicoRequestConfig, validateSignature, updateOrderStatus };
