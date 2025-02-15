require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createIyzicoRequestConfig, validateSignature, updateOrderStatus } = require('./requestHelper');
const morgan = require('morgan');
const cors = require('cors');
const app = express();
const Sentry = require('@sentry/node');
const { pool } = require('./db');
const { v4: uuidv4 } = require('uuid');

const IYZICO_BASE_URL = process.env.IYZICO_BASE_URL;

/// MIDDLEWARES
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
});
Sentry.setupExpressErrorHandler(app);

/// ROUTES
// Create payment
app.post('/payment', async (req, res) => {
  const { paymentChannel, installment, currency, basketItems, paymentCard, customer, shippingAddress, billingAddress } = req.body;

  if (!paymentChannel || !installment || !currency) {
    return res.status(400).send('paymentChannel, installment and currency are required');
  }

  if (!customer.id || !customer.name || !customer.surname || !customer.email || !customer.phone || !customer.registrationAddress || !customer.city || !customer.country) {
    return res.status(400).send('customer id, name, surname, email, phone, registrationAddress, city and country are required');
  }

  // TODO: Check if customer exists
  // TODO: Return customer_id if exist, create a new id if not exist

  let totalPrice = 0;
  basketItems.forEach((item) => {
    if (!item.id || !item.name || !item.price || !item.category1) {
      return res.status(400).send('basketItems id, name, category1 and price are required');
    }
    totalPrice += Number(item.price);
  });

  if (!paymentCard.cardHolderName || !paymentCard.cardNumber || !paymentCard.expireMonth || !paymentCard.expireYear || !paymentCard.cvc) {
    return res.status(400).send('paymentCard cardHolderName, cardNumber, expireMonth, expireYear and cvc are required');
  }

  const vat = parseFloat((totalPrice * 0.18).toFixed(2));
  const shippingPrice = 0;
  const discount = 0;
  customer.identityNumber = customer.identityNumber || '74300864791';
  customer.ip = customer.ip || '85.34.78.112';
  const conversationId = uuidv4();
  const basketId = uuidv4();

  const netPrice = parseFloat((totalPrice + vat + shippingPrice - discount).toFixed(2));
  const uriPath = '/payment/auth';
  const requestBody = {
    locale: 'tr',
    conversationId: conversationId,
    price: totalPrice,
    paidPrice: netPrice,
    installment,
    paymentChannel,
    basketId: basketId,
    paymentGroup: 'PRODUCT',
    paymentCard,
    buyer: customer,
    shippingAddress,
    billingAddress,
    basketItems,
    currency,
  };

  try {
    const config = createIyzicoRequestConfig(uriPath, requestBody);

    const response = await axios.post(`${IYZICO_BASE_URL}${uriPath}`, requestBody, config);

    if (response.data.status === 'failure') {
      return res.status(400).json({
        errorCode: response.data.errorCode,
        errorMessage: response.data.errorMessage,
      });
    }

    await pool.query(
      `INSERT INTO payments (amount, payment_date, user_id, status, method, iyzico_payment_id, conversation_id, basket_id, iyzico_payment_transaction_id, iyzico_raw_response) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        response.data.paidPrice,
        new Date(),
        customer.id,
        'pending',
        'credit_card',
        response.data.paymentId,
        response.data.conversationId,
        response.data.basketId,
        response.data.itemTransactions[0].paymentTransactionId,
        JSON.stringify(response.data),
      ]
    );
    return res.status(200).json({
      status: response.data.status,
      conversationId: response.data.conversationId,
      price: response.data.price,
      paidPrice: response.data.paidPrice,
      installment: response.data.installment,
      paymentId: response.data.paymentId,
      itemTransactions: Array.isArray(response.data.itemTransactions) ? response.data.itemTransactions.map((item) => ({
        itemId: item.itemId,
        paymentTransactionId: item.paymentTransactionId,
        price: item.price,
        paidPrice: item.paidPrice,
      })) : [],
    });

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('Database connection refused:', error);
      return res.status(500).json({ message: 'Database connection refused.' });
    }
    res.status(error.response?.status || 500).json({
      error: 'Payment processing failed',
      details: error.message || response.data.errorMessage,
      errorCode: error.response?.data.errorCode,
    });
  }

});

// Get payment created before
app.get('/payment', async (req, res) => {
  const { paymentId, locale, conversationId, paymentConversationId } = req.body;
  const uriPath = '/payment/detail';
  const ip = '85.34.78.112';
  if (!paymentId || !ip || !conversationId) {
    return res.status(400).send('paymentId, ip and conversationId are required');
  }

  const requestBody = {
    locale: locale || 'tr',
    conversationId,
    paymentId,
    paymentConversationId: paymentConversationId || conversationId,
    ip,
  };

  try {
    const config = createIyzicoRequestConfig(uriPath, requestBody);
    const response = await axios.post(`${IYZICO_BASE_URL}${uriPath}`, requestBody, config);

    if (response.data.status === 'failure') {
      return res.status(400).json({
        errorCode: response.data.errorCode,
        errorMessage: response.data.errorMessage,
      });
    }
    return res.status(200).send(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'payment detail fetching failed',
      details: error.message,
    });
  }
});

// Refund payment
app.post('/payment/refund', async (req, res) => {
  const { paymentTransactionId, price, conversationId, locale } = req.body;
  const uriPath = '/payment/refund';
  if (!paymentTransactionId || !price || !conversationId) {
    return res.status(400).send('paymentTransactionId, price and conversationId are required');
  }

  const requestBody = {
    locale: locale || 'tr',
    conversationId,
    paymentTransactionId,
    price,
  };

  try {
    const config = createIyzicoRequestConfig(uriPath, requestBody);
    const response = await axios.post(`${IYZICO_BASE_URL}${uriPath}`, requestBody, config);

    if (response.data.status === 'failure') {
      return res.status(400).json({
        errorCode: response.data.errorCode,
        errorMessage: response.data.errorMessage,
      });
    }
    return res.status(200).send(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'payment refund failed',
      details: error.message,
    });
  }
});

// Cancel payment
app.post('/payment/cancel', async (req, res) => {
  const { paymentId, conversationId, locale } = req.body;
  const uriPath = '/payment/cancel';
  if (!paymentId || !conversationId) {
    return res.status(400).send('paymentId and conversationId are required');
  }

  const requestBody = {
    locale: locale || 'tr',
    conversationId,
    paymentId,
  };

  try {
    const config = createIyzicoRequestConfig(uriPath, requestBody);
    const response = await axios.post(`${IYZICO_BASE_URL}${uriPath}`, requestBody, config);

    if (response.data.status === 'failure') {
      return res.status(400).json({
        errorCode: response.data.errorCode,
        errorMessage: response.data.errorMessage,
      });
    }
    return res.status(200).send(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'payment cancel failed',
      details: error.message,
    });
  }
});

// Webhook endpoint
app.post('/webhook/iyzico', (req, res) => {
  const signatureHeader = req.headers['X-Iyz-Signature-V3'];
  const payload = req.body;

  let isValid = validateSignature(payload, signatureHeader);

  isValid = 'x-iyz-signature' in req.headers;

  if (isValid) {
      const status = payload.status;
      const paymentConversationId = payload.paymentConversationId;
      const paymentId = payload.paymentId;

      switch(status) {
          case 'SUCCESS':
              console.log(`Ödeme başarılı. Sipariş ID: ${paymentConversationId}`);
              updateOrderStatus(paymentConversationId, status);
              break;
          case 'FAILURE':
              console.log(`Ödeme başarısız. Sipariş ID: ${paymentConversationId}`);
              updateOrderStatus(paymentConversationId, status);
              break;
          case 'PENDING_CREDIT':
              console.log(`Kredi işlemi beklemede. Sipariş ID: ${paymentConversationId}`);
              updateOrderStatus(paymentConversationId, status);
              break;
          default:
              console.log(`Bilinmeyen durum: ${status}`);
      }
      res.status(200).send('OK');
  } else {
      console.log('Doğrulama başarısız!');
      res.status(400).send('Invalid signature');
  }
});

/// SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
