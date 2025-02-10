# Payment Service

A Node.js payment service that integrates with the Iyzico payment gateway. This service provides endpoints for payment processing, refunds, cancellations, and payment details.

## Setup

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with the following variables:

```bash
IYZICO_BASE_URL=<your_iyzico_api_url>
IYZICO_API_KEY=<your_api_key>
IYZICO_SECRET_KEY=<your_secret_key>
PORT=5000
```

## API Routes

### Process Payment

- **POST** `/payment`
- Processes a new payment transaction
- Required fields:
  - paymentChannel
  - installment
  - currency
  - customer details (id, name, surname, email, phone, etc.)
  - basketItems (id, name, price, category1)
  - paymentCard details (cardHolderName, cardNumber, expireMonth, expireYear, cvc)

### Get Payment Details

- **GET** `/payment`
- Retrieves payment details
- Required fields:
  - paymentId
  - ip
  - conversationId

### Refund Payment

- **POST** `/payment/refund`
- Processes a refund for a payment
- Required fields:
  - paymentTransactionId
  - price
  - conversationId

### Cancel Payment

- **POST** `/payment/cancel`
- Cancels a payment
- Required fields:
  - paymentId
  - conversationId

## Error Handling

All endpoints return appropriate HTTP status codes:

- 200: Successful operation
- 400: Bad request (missing or invalid parameters)
- 500: Server error

Error responses include:

```json
{
  "errorCode": "ERROR_CODE",
  "errorMessage": "Detailed error message"
}
```

## Security

- CORS enabled
- Request logging with Morgan
- Input validation for all endpoints
