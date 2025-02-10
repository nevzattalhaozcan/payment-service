require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createIyzicoRequestConfig } = require('./requestHelper');
const morgan = require('morgan');
const cors = require('cors');
const app = express();
const Sentry = require("@sentry/node");
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
app.post('/payment', async (req, res) => {
  const {
    paymentChannel,
    installment,
    currency,
    basketItems,
    paymentCard,
    customer,
    shippingAddress,
    billingAddress,
  } = req.body;

  if (!paymentChannel || !installment || !currency) {
    return res.status(400).send('paymentChannel, installment and currency are required');
  }

  if (
    !customer.id ||
    !customer.name ||
    !customer.surname ||
    !customer.email ||
    !customer.phone ||
    !customer.registrationAddress ||
    !customer.city ||
    !customer.country
  ) {
    return res
      .status(400)
      .send('customer id, name, surname, email, phone, registrationAddress, city and country are required');
  }

  let totalPrice = 0;
  basketItems.forEach((item) => {
    if (!item.id || !item.name || !item.price || !item.category1) {
      return res.status(400).send('basketItems id, name, category1 and price are required');
    }
    totalPrice += Number(item.price);
  });

  if (
    !paymentCard.cardHolderName ||
    !paymentCard.cardNumber ||
    !paymentCard.expireMonth ||
    !paymentCard.expireYear ||
    !paymentCard.cvc
  ) {
    return res
      .status(400)
      .send('paymentCard cardHolderName, cardNumber, expireMonth, expireYear and cvc are required');
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
      'INSERT INTO payments (amount, payment_date, user_id, status, method, iyzico_payment_id, conversation_id, basket_id, iyzico_payment_transaction_id, iyzico_raw_response) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
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
    return res.status(200).send(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: 'payment processing failed',
      details: error.message,
    });
  }
});

app.get('/payment', async (req, res) => {
  const { paymentId, ip, locale, conversationId, paymentConversationId } = req.body;
  const uriPath = '/payment/detail';
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

/// SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
