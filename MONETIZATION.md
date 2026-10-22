# Launch and earn

The app is free to use. The first paid offer is a reusable **14-Day Chess Practice Journal**, suggested test price **$3**. This is a price experiment, not an earnings forecast.

## What is ready

- A mobile-friendly website and installable web app, using local Stockfish analysis.
- Free seven-day plans that give visitors a useful first result.
- A 19-page original printable journal at `output/pdf/Chess-Practice-Journal.pdf`.
- Optional shop, tip and sponsored placement components. They stay hidden until configured with real HTTPS URLs.
- Private hosted review copy through Sites. Public access must be enabled before using it to attract customers.

## Activate the first revenue stream

1. In your own Ko-fi account, connect your own Stripe or PayPal account. Review its terms and any age/eligibility requirements yourself.
2. Create a digital shop product. Upload the PDF above. Use the title and description in `output/SHOP-LISTING.txt` and set a $3 test price. Ko-fi delivers the file to buyers; this site does not handle checkout or grant paid access.
3. Copy the product URL and run:

   ```sh
   node scripts/configure-revenue.mjs shop https://ko-fi.com/s/YOUR_PRODUCT
   ```

4. Optionally configure your tip page:

   ```sh
   node scripts/configure-revenue.mjs tip https://ko-fi.com/YOUR_PAGE
   ```

5. Reload locally to inspect the real checkout destination, then redeploy. Do not store API keys or payout credentials in `static/config.js`; it is public.

Ko-fi currently charges 5% on shop sales; normal payment-processing fees also apply. Its Free mode has 0% Ko-fi fees on one-time tips, while Standard mode charges 5% on tips too. Source: https://help.ko-fi.com/hc/en-us/articles/360002506494-Does-Ko-fi-take-a-fee (checked October 22, 2026).

## Get the first visitors

- Use the sample report link (`?demo=1`) so people can inspect the product without waiting for analysis.
- Analyze your own games and share your exported summary image with one specific lesson you learned. Include the actual public site URL. Post only where tools and self-promotion are allowed.
- Ask a few chess friends or a club to test it. Ask whether the report led to a useful practice session, not just whether the design looks good.
- Watch actual interest before adding subscriptions or buying ads. No traffic or conversions are assumed in this project.

## Sponsorship and affiliates

Once you have evidence of visitors, offer one plainly labeled placement to a chess coach or training product. Fill in `CONFIG.sponsor` only after agreeing the content, dates and payment separately. The app does not bill sponsors or enforce placement expiry. Remove the configuration at the end of the agreement.

For affiliate links, join the provider's program first and obtain your own approved tracking URLs. Set a resource's `affiliate: true` only when it is genuinely an affiliate link. Do not invent affiliate identifiers or claim a relationship you do not have.

## Why no ad network yet?

AdSense requires original eligible content, compliance with its policies and site approval. It also has an adult account-holder requirement. No ad account, publisher ID, consent platform or approval has been provided, so no ad script is installed. Ads are a later experiment after you have a public site and recurring visitors. Source: https://support.google.com/adsense/answer/9724?hl=en (checked October 22, 2026).

## Hosting

The static site needs HTTPS for app installation and service-worker support (localhost also works for development). A native app store build is unnecessary for this first version. Sites starts owner-private; use its sharing controls deliberately before public promotion. The project can also be hosted by any static host using `static/` as its output directory.

## Honest limits

This project does not guarantee sales, rating improvement, or ad approval. The checkout and payout setup need your identity and seller account. A local payment button is not a verified payment system; inspect the real provider page and use its own purchase/test flow before promoting the product.
