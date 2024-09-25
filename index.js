const express = require("express");
const cors = require("cors");
const stripe = require("stripe");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = 3001;

// Replace with your actual Stripe secret key
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());

app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

const plans = {
  individual: {
    name: "Individual",
    monthlyPrice: 2995, // $29.95
    annualPrice: 28500, // $285
    description: "Advanced coaching for professionals",
  },
  team: {
    name: "Team",
    monthlyPrice: 4995, // $49.95
    annualPrice: 44500, // $445
    description: "Comprehensive solution for teams",
  },
};

app.post("/create-checkout-session", async (req, res) => {
  const { plan, billingPeriod } = req.body;

  console.log("plan", plan);
  console.log("billingCycle", billingPeriod);

  if (!plans[plan]) {
    return res.status(400).json({ error: "Invalid plan selected" });
  }

  if (billingPeriod !== "monthly" && billingPeriod !== "annual") {
    return res.status(400).json({ error: "Invalid billing cycle" });
  }

  const selectedPlan = plans[plan];
  const price =
    billingPeriod === "monthly"
      ? selectedPlan.monthlyPrice
      : selectedPlan.annualPrice;
  const interval = billingPeriod === "monthly" ? "month" : "year";

  try {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `AgentCoach.AI ${selectedPlan.name} Plan (${billingPeriod})`,
              description: selectedPlan.description,
            },
            recurring: {
              interval: interval,
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.FRONTEND_URL}/pricing`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// New route to cancel a subscription
app.post("/cancel-subscription", async (req, res) => {
  const { subscriptionId } = req.body;

  if (!subscriptionId) {
    return res.status(400).json({ error: "Subscription ID is required" });
  }

  try {
    const subscription = await stripeClient.subscriptions.update(
      subscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    console.log("Subscription scheduled for cancellation:", subscription.id);

    // TODO: Update user's subscription status in your database to reflect pending cancellation

    res.json({
      message:
        "Subscription scheduled for cancellation at the end of the billing period",
      cancellationDate: new Date(subscription.cancel_at * 1000).toISOString(),
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// Stripe webhook route
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Add this to your .env file

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case "customer.subscription.created":
        const subscriptionCreated = event.data.object;
        // Handle subscription created
        console.log("Subscription created:", subscriptionCreated.id);
        // TODO: Update user's subscription status in your database
        break;
      case "customer.subscription.updated":
        const subscriptionUpdated = event.data.object;
        // Handle subscription update
        console.log("Subscription updated:", subscriptionUpdated.id);
        // TODO: Update user's subscription details in your database
        break;
      case "customer.subscription.deleted":
        const subscriptionDeleted = event.data.object;
        // Handle subscription cancellation
        console.log("Subscription canceled:", subscriptionDeleted.id);
        // TODO: Update user's subscription status in your database
        break;
      case "invoice.payment_succeeded":
        const invoice = event.data.object;
        // Handle successful payment
        console.log("Payment succeeded for invoice:", invoice.id);
        // TODO: Update user's payment status in your database
        break;
      case "invoice.payment_failed":
        const failedInvoice = event.data.object;
        // Handle failed payment
        console.log("Payment failed for invoice:", failedInvoice.id);
        // TODO: Notify user of failed payment and update status in your database
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    // Return a response to acknowledge receipt of the event
    res.json({ received: true });
  }
);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
