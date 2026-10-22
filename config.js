// Site-wide settings, including everything that earns money. Every field is
// optional: leave it empty and the matching UI simply doesn't render.
export const CONFIG = {
  // Public URL of the deployed site, used for share links (e.g. "https://chessweakness.com/").
  // Leave empty to use whatever URL the page was loaded from.
  siteUrl: "https://anishchinnam.github.io/chess-weakness-finder/",

  // "Buy me a coffee" style tip link (Ko-fi, Buy Me a Coffee, GitHub Sponsors, Stripe Payment Link…).
  tipUrl: "https://paypal.me/bhanuchinnam",
  tipLabel: "Support this project via PayPal",

  // Sell the included training journal through a real digital-download shop.
  // The button is hidden until the HTTPS checkout URL is configured.
  shop: { url: "", label: "Get the training journal · $3" },

  // A direct sponsor placement, hidden until all required fields are present.
  // Agree payment and dates with the sponsor before enabling it.
  sponsor: { name: "", description: "", url: "", label: "Explore" },

  // Email capture. Point formAction at a newsletter provider's embed endpoint
  // (e.g. Buttondown: https://buttondown.com/api/emails/embed-subscribe/<you>).
  // The form POSTs a single "email" field and opens the provider in a new tab.
  newsletter: {
    formAction: "",
    pitch: "Get a free 7-day training plan for your top weakness, plus a monthly re-check reminder.",
  },

  // Training links shown under each weakness. Swap these for affiliate URLs once
  // you're accepted into the programs (Chessable, Chess.com, Amazon Associates…).
  // Keys match the mistake themes the analyzer detects.
  resources: {
    hung: { label: "Train board vision & simple tactics →", url: "https://lichess.org/training" },
    missed_tactic: { label: "Do a daily puzzle set on Lichess →", url: "https://lichess.org/training/mix" },
    endgame: { label: "Practice endgames interactively →", url: "https://lichess.org/practice" },
    opening: { label: "Learn a repertoire on Chessable →", url: "https://www.chessable.com/" },
    positional: { label: "Study strategy lessons on Chess.com →", url: "https://www.chess.com/lessons" },
  },

  // Privacy-friendly analytics. Set to your domain to load Plausible
  // (https://plausible.io); custom events track analyses, shares and link clicks.
  plausibleDomain: "",
};
