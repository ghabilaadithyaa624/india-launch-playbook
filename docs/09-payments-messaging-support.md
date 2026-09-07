# 09 · Payments, messaging and support

The customer remembers the failure state more than the happy path. Design it before you connect a payment gateway or WhatsApp / SMS provider.

## Payments checklist

- Map the states: initiated, authorised, captured / paid, failed, refunded, reversed, disputed and reconciled.
- Define who can issue a refund, what evidence they need and how the customer is notified.
- Never store payment-card data unless your authorised provider and compliance model explicitly support it.
- Reconcile provider reports, orders and bank settlements. Investigate unmatched items on a defined cadence.

## Messaging checklist

- Separate transactional, service and marketing messages. Use approved / registered routes where required.
- Keep a consent / preference history appropriate to your communication type and provider obligations.
- Write messages that identify the business, explain the action and provide a customer-support route.
- Create a fallback when OTP or delivery messaging fails; do not expose sensitive information in a message.

## Support minimum

Publish a support channel, response expectation, escalation owner and business hours. Create reusable answers for account access, payment failure, refund, privacy request and service dispute. Track recurring requests; they are your best product-research dataset.
