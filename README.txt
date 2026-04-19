2BitCrypto Website
==================

Files included:
- index.html
- styles.css
- script.js

How to run:
1. Extract the folder.
2. Open index.html in your browser.
3. For best live-feed behaviour, serve it with a small local web server.
   Example with Python:
   python -m http.server 8000
   Then open http://localhost:8000

Notes:
- Live coin prices are pulled from Coinranking using the supplied API key.
- CryptoRank headlines and YouTube feed use public fetches with browser-friendly fallbacks.
- Newsletter and promo forms currently save locally in the browser and download promo requests as JSON.
- To collect real submissions publicly, connect the forms to a backend, Formspree, Basin, ConvertKit, Mailchimp, or your own API.
