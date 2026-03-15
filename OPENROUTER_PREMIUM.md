# Configuration OpenRouter Premium

Quand tu auras ajouté des crédits sur https://openrouter.ai/settings/credits

## Modifier dans `backend/server.js` (lignes 59-68)

Remplacer :
```javascript
// Modèles pour roleplay immersif - openrouter/free sélectionne auto les modèles gratuits dispo
const PRIMARY_MODEL = 'openrouter/auto';
const FALLBACK_MODELS = [
    'openrouter/auto',           // Auto-select best available
    'deepseek/deepseek-r1:free', // DeepSeek R1 gratuit
    'meta-llama/llama-4-scout:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'google/gemini-2.0-flash-exp:free'
];
```

Par :
```javascript
// Modèles premium pour roleplay immersif (avec crédits OpenRouter)
const PRIMARY_MODEL = 'anthropic/claude-3.5-sonnet';
const FALLBACK_MODELS = [
    'anthropic/claude-3.5-sonnet',    // Meilleur pour personnalité/roleplay
    'openai/gpt-4o',                   // Très fluide et naturel
    'meta-llama/llama-3.3-70b-instruct', // Bon rapport qualité/prix
    'mistralai/mistral-large',         // Alternative solide
    'openrouter/auto'                  // Fallback gratuit
];
```

## Après modification

```bash
docker-compose down && docker-compose up -d --build
```

## Coût estimé

- Claude 3.5 Sonnet : ~$3 / million tokens
- GPT-4o : ~$5 / million tokens
- Llama 3.3 70B : ~$0.50 / million tokens

Avec $5-10 de crédits, tu peux tenir plusieurs semaines d'utilisation normale.
