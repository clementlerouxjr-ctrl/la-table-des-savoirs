# La Table des Savoirs — menu chatbot prototype

A mobile-friendly guest chat page and a separate password-protected manager update portal.

## Included information
- Institut Lyfe school canteen, Écully, France
- Menus supplied for 23–27 November 2026
- Meal price: 10€
- Opening hours: 11:00–13:00
- Open to students, Institut Lyfe staff and external guests
- Vegetarian option changes daily; vegetarian, not confirmed vegan

## Run locally
Requires Node.js 18 or later.

```bash
npm start
```

Set a manager password and, for LLM-generated answers, an API key as server-side environment variables:

```bash
ADMIN_PASSWORD="choose-a-strong-password" OPENAI_API_KEY="your-api-key" npm start
```

The API key is read only by the server and is not sent to the browser. Without it, the app uses rule-based demo responses, not an LLM.

## Before real public use
- Store staff updates in a persistent database. The current prototype writes to a local JSON file, which can be lost on ephemeral hosting.
- Use stronger manager authentication, HTTPS and rate limiting.
- Configure `ADMIN_PASSWORD`, `OPENAI_API_KEY`, and optionally `OPENAI_MODEL` in the host's environment settings. Never place secrets in the repository.
- Verify content and operating procedures with Institut Lyfe.

The chatbot has no live stock/POS connection, booking, ordering, or payment functionality. It cannot verify allergens or cross-contact and must direct guests with allergies to canteen staff. Only the dated menus listed above are available.
