const express = require('express');
const router = express.Router();
const { fetchScryfallCard } = require('../middleware/scryfall');
const AuthMiddleware = require('../middleware/auth');
const authenticateToken = AuthMiddleware.authenticateToken;
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: "eu-central-1" });
const dynamoDb = DynamoDBDocumentClient.from(client);
const CARDS_TABLE = 'cardsTable';
const SCRYFALL_TTL_HOURS = 24;

// Helper to get DynamoDB key
function getKey(setCode, cardNumber) {
  return `${setCode.toLowerCase()}:${cardNumber}`;
}

// Helper to validate input
function validateCardInput(setCode, cardNumber, amount) {
  if (typeof setCode !== 'string' || setCode.length < 1 || setCode.length > 6) return 'Invalid setCode'
  if (!Number.isInteger(Number(amount)) || Number(amount) <= 0) return 'Invalid amount';
  return null;
}

// Helper to check TTL
function isScryfallExpired(card) {
  if (!card.scryfall || !card.scryfall_ttl) return true;
  return Date.now() > card.scryfall_ttl;
}

/**
 * @swagger
 * /cards/{setCode}/{cardNumber}:
 *   get:
 *     operationId: getCard
 *     summary: Get card info by setCode and cardNumber.
 *     description: Call this function to return a single card object in the collection. You need the setcode and cardnumber.
 *     parameters:
 *       - in: path
 *         name: setCode
 *         description: The set code of the card (e.g., "KHM")
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         description: The card number within the set (e.g., "123")
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Card info
 *       404:
 *         description: Card not found
 */
// GET: Return card info, refresh Scryfall if expired
router.get('/:setCode/:cardNumber', async (req, res) => {
  // Ensure setCode is lowercase
  const setCode = req.params.setCode.toLowerCase();
  const { cardNumber } = req.params;
  const key = getKey(setCode, cardNumber);
  try {
    const result = await dynamoDb.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    let card = result.Item;
    if (!card) return res.status(404).json({ error: 'Card not found' });

    // Refresh Scryfall if expired
    if (isScryfallExpired(card)) {
      const scryfallData = await fetchScryfallCard(setCode, cardNumber);
      card.scryfall = scryfallData;
      card.scryfall_ttl = Date.now() + SCRYFALL_TTL_HOURS * 3600 * 1000;
      await dynamoDb.send(new PutCommand({
        TableName: CARDS_TABLE,
        Item: card
      }));
    }
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: 'DynamoDB error', details: err });
  }
});

/**
 * @swagger
 * /cards/{setCode}/{cardNumber}:
 *   post:
 *     operationId: createCard
 *     summary: Create or increment card (protected)
 *     description: Call this function to add a new card to the collection, or increment the amount for a specific finish if it already exists. You must provide a "finishes" array in the request body, with at least one finish. Each finish must be an object containing "finish" (string), "amount" (integer), and optional "notes" (string). The available finishes will be validated.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: setCode
 *         description: The set code of the card (e.g., "KHM")
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         description: The card number within the set (e.g., "123")
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: ['finishes']
 *             properties:
 *               finishes:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: ['finish', 'amount']
 *                   properties:
 *                     finish:
 *                       type: string
 *                       description: The finish type (e.g., "nonfoil", "foil", "etched", "glossy")
 *                     amount:
 *                       type: integer
 *                       description: Number of copies for this finish
 *                     notes:
 *                       type: string
 *                       description: Optional notes for this finish
 *     responses:
 *       200:
 *         description: Card updated
 *       201:
 *         description: Card created
 *       400:
 *         description: Invalid input
 */
// POST: Create or increment card (protected)
router.post('/:setCode/:cardNumber', authenticateToken, async (req, res) => {
  // Ensure setCode is lowercase
  const setCode = req.params.setCode.toLowerCase();
  const { cardNumber } = req.params;

  // Check for missing request body
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'Missing request body' });
  }

  let body = req.body;
  const key = getKey(setCode, cardNumber)

  try {
    const result = await dynamoDb.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    console.log('Existing card:', result.Item);
    let card = result.Item;
    let scryfallData;
    if (!card || isScryfallExpired(card)) {
      scryfallData = await fetchScryfallCard(setCode, cardNumber);
    } else {
      scryfallData = card.scryfall;
    }
    console.log('Scryfall data:', scryfallData);
    const validFinishes = Array.isArray(scryfallData.finishes) ? scryfallData.finishes : [];
    console.log('Valid finishes:', validFinishes);
    console.log('Posted finishes:', body.finishes);
    for (const finishObj of body.finishes) {
      if (!finishObj.finish || !validFinishes.includes(finishObj.finish)) {
        return res.status(400).json({
          error: `The finish "${finishObj.finish}" does not exist for card ${setCode}:${cardNumber}`
        });
      }
    }

    if (card) {
      // Card exists: merge finishes
      const existingFinishes = Array.isArray(card.finishes) ? card.finishes : [];
      const now = new Date();
      const datetime = now.toISOString().slice(0, 16).replace('T', ' ');

      // Map existing finishes for quick lookup
      const finishMap = {};
      for (const f of existingFinishes) {
        finishMap[f.finish] = { ...f };
      }

      for (const posted of body.finishes) {
        if (finishMap[posted.finish]) {
          // Increment amount
          finishMap[posted.finish].amount += Number(posted.amount);
          // Append notes
          if (posted.notes) {
            const noteStr = `${datetime} ${posted.notes}`;
            finishMap[posted.finish].notes = (finishMap[posted.finish].notes ? finishMap[posted.finish].notes + '\n' : '') + noteStr;
          }
        } else {
          // New finish: set amount and notes
          finishMap[posted.finish] = {
            finish: posted.finish,
            amount: Number(posted.amount),
            notes: posted.notes ? `${datetime} ${posted.notes}` : ''
          };
        }
      }

      // Convert back to array
      body.finishes = Object.values(finishMap);
    } else {
      // New card: set amount and notes for each finish
      const now = new Date();
      const datetime = now.toISOString().slice(0, 16).replace('T', ' ');
      body.finishes = body.finishes.map(finishObj => ({
        ...finishObj,
        amount: Number(finishObj.amount),
        notes: finishObj.notes ? `${datetime} ${finishObj.notes}` : ''
      }));
    }

    card = {
      CardId: key,
      finishes: body.finishes,
      scryfall: scryfallData,
      scryfall_ttl: Date.now() + SCRYFALL_TTL_HOURS * 3600 * 1000
    };
    console.log("card to save:", card);
    await dynamoDb.send(new PutCommand({
      TableName: CARDS_TABLE,
      Item: card
    }));
    res.status(201).json(card);
  } catch (err) {
    console.error('POST /:setCode/:cardNumber/ error:', err);
    res.status(500).json({ error: 'DynamoDB error', details: err });
  }
});

/**
 * @swagger
 * /cards/{setCode}/{cardNumber}:
 *   patch:
 *     operationId: updateCard
 *     summary: Update card finishes and amount (protected)
 *     description: Call this function to update the finishes and amount of a specific card in the collection. You must provide a "finishes" array in the request body, with at least one finish. Each finish must be an object containing "finish" (string), "amount" (integer), and optional "notes" (string). Setting the amount of a finish to 0 will remove that finish. If all finishes are removed, the card will be deleted.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: setCode
 *         description: The set code of the card (e.g., "KHM")
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         description: The card number within the set (e.g., "123")
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: ['finishes']
 *             properties:
 *               finishes:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: ['finish', 'amount']
 *                   properties:
 *                     finish:
 *                       type: string
 *                       description: The finish type (e.g., "nonfoil", "foil", "etched", "glossy")
 *                     amount:
 *                       type: integer
 *                       description: Number of copies for this finish (set to 0 to remove)
 *                     notes:
 *                       type: string
 *                       description: Optional notes for this finish
 *     responses:
 *       200:
 *         description: Card updated
 *       204:
 *         description: Card deleted
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Card not found
 */
// PATCH: Update amount (protected)
router.patch('/:setCode/:cardNumber', authenticateToken, async (req, res) => {
  // Ensure setCode is lowercase
  const setCode = req.params.setCode.toLowerCase();
  const { cardNumber } = req.params;
  const key = getKey(setCode, cardNumber);

  // Check for missing request body
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'Missing request body' });
  }

  let { finishes } = req.body;
  if (!Array.isArray(finishes) || finishes.length === 0) {
    return res.status(400).json({ error: 'finishes array required' });
  }

  try {
    const result = await dynamoDb.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    let card = result.Item;
    if (!card) return res.status(404).json({ error: 'Card not found' });

    // Validate finishes against Scryfall
    let scryfallData = card.scryfall;
    if (isScryfallExpired(card)) {
      scryfallData = await fetchScryfallCard(setCode, cardNumber);
    }
    const validFinishes = Array.isArray(scryfallData.finishes) ? scryfallData.finishes : [];
    for (const finishObj of finishes) {
      if (!finishObj.finish || !validFinishes.includes(finishObj.finish)) {
        return res.status(400).json({
          error: `The finish "${finishObj.finish}" does not exist for card ${setCode}:${cardNumber}`
        });
      }
      if (!Number.isInteger(Number(finishObj.amount)) || Number(finishObj.amount) < 0) {
        return res.status(400).json({ error: `Invalid amount for finish "${finishObj.finish}"` });
      }
    }

    // Merge finishes
    const existingFinishes = Array.isArray(card.finishes) ? card.finishes : [];
    const finishMap = {};
    for (const f of existingFinishes) {
      finishMap[f.finish] = { ...f };
    }

    const now = new Date();
    const datetime = now.toISOString().slice(0, 16).replace('T', ' ');

    for (const posted of finishes) {
      if (finishMap[posted.finish]) {
        // Update amount
        finishMap[posted.finish].amount = Number(posted.amount);
        // Append notes
        if (posted.notes) {
          const noteStr = `${datetime} ${posted.notes}`;
            finishMap[posted.finish].notes = (finishMap[posted.finish].notes ? finishMap[posted.finish].notes + '\n' : '') + noteStr;
        }
      } else {
        // New finish: set amount and notes
        finishMap[posted.finish] = {
          finish: posted.finish,
          amount: Number(posted.amount),
          notes: posted.notes ? `${datetime} ${posted.notes}` : ''
        };
      }
    }

    // Remove finishes with amount 0
    const updatedFinishes = Object.values(finishMap).filter(f => f.amount > 0);

    // If no finishes remain, delete the card
    if (updatedFinishes.length === 0) {
      await dynamoDb.send(new DeleteCommand({
        TableName: CARDS_TABLE,
        Key: { CardId: key }
      }));
      return res.status(204).send();
    }

    // Update card
    card.finishes = updatedFinishes;
    card.scryfall = scryfallData;
    card.scryfall_ttl = Date.now() + SCRYFALL_TTL_HOURS * 3600 * 1000;

    await dynamoDb.send(new PutCommand({
      TableName: CARDS_TABLE,
      Item: card
    }));

    res.json(card);
  } catch (err) {
    res.status(500).json({ error: 'DynamoDB error', details: err });
  }
});

/**
 * @swagger
 * /cards/{setCode}/{cardNumber}:
 *   delete:
 *     operationId: deleteCard
 *     summary: Delete card (protected)
 *     description: Call this function to delete a specific card from the collection. You need to pass card number and set code as path parameters.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: setCode
 *         description: The set code of the card (e.g., "KHM")
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         description: The card number within the set (e.g., "123")
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Card deleted
 *       404:
 *         description: Card not found
 */
// DELETE: Remove card (protected)
router.delete('/:setCode/:cardNumber', authenticateToken, async (req, res) => {
  // Ensure setCode is lowercase
  const setCode = req.params.setCode.toLowerCase();
  const { cardNumber } = req.params;
  const key = getKey(setCode, cardNumber);
  try {
    const result = await dynamoDb.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    if (!result.Item) return res.status(404).json({ error: 'Card not found' });
    await dynamoDb.send(new DeleteCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'DynamoDB error', details: err });
  }
});

/**
 * @swagger
 * /cards:
 *   get:
 *     operationId: getAllCards
 *     summary: Get all cards
 *     description: Call this function to return all cards in the collection as a JSON object. It is an array of everything in the collection, where each object key consists of "setcode:cardnumber", e.g. "khm:123".
 *     responses:
 *       200:
 *         description: A list of cards
 */
// Export all cards as JSON
router.get('/', async (req, res) => {
  try {
    const result = await dynamoDb.send(new ScanCommand({ TableName: CARDS_TABLE }));
    // Return as { [CardId]: card }
    const cardsObj = {};
    for (const card of result.Items) {
      cardsObj[card.CardId] = card;
    }
    res.json(cardsObj);
  } catch (err) {
    res.status(500).json({ error: 'DynamoDB error', details: err });
  }
});

module.exports = router;
