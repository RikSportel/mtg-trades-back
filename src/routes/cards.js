const express = require('express');
const router = express.Router();
const Card = require('../models/card');
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
function getKey(setCode, cardNumber, foil) {
  return `${setCode}:${cardNumber}:${foil ? 'foil' : 'nonfoil'}`;
}

// Helper to validate input
function validateCardInput(setCode, cardNumber, foil, amount) {
  if (typeof setCode !== 'string' || setCode.length < 1 || setCode.length > 6) return 'Invalid setCode';
  if (!Number.isInteger(Number(cardNumber)) || Number(cardNumber) <= 0) return 'Invalid cardNumber';
  if (typeof foil !== 'boolean') return 'Invalid foil';
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
 * /cards/{setCode}/{cardNumber}/{foil}:
 *   get:
 *     operationId: getCard
 *     summary: Get card info by setCode, cardNumber, and foil
 *     parameters:
 *       - in: path
 *         name: setCode
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: foil
 *         required: true
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Card info
 *       404:
 *         description: Card not found
 */
// GET: Return card info, refresh Scryfall if expired
router.get('/:setCode/:cardNumber/:foil', async (req, res) => {
  const { setCode, cardNumber, foil } = req.params;
  const key = getKey(setCode, cardNumber, foil === 'true');
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
 * /cards/{setCode}/{cardNumber}/{foil}:
 *   post:
 *     operationId: createCard
 *     summary: Create or increment card (protected)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: setCode
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: foil
 *         required: true
 *         schema:
 *           type: boolean
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Card updated
 *       201:
 *         description: Card created
 *       400:
 *         description: Invalid input
 */
// POST: Create or increment card (protected)
router.post('/:setCode/:cardNumber/:foil', authenticateToken, async (req, res) => {
  const { setCode, cardNumber, foil } = req.params;
  let { amount = 1 } = req.body;
  const foilBool = foil === 'true';
  amount = Number(amount);
  const validationError = validateCardInput(setCode, cardNumber, foilBool, amount);
  if (validationError) return res.status(400).json({ error: validationError });
  const key = getKey(setCode, cardNumber, foilBool);

  try {
    const result = await dynamoDb.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    let card = result.Item;
    if (card) {
      card.amount += amount;
      await dynamoDb.send(new PutCommand({
        TableName: CARDS_TABLE,
        Item: card
      }));
      return res.status(200).json(card);
    }
    // Fetch Scryfall data for new card
    const scryfallData = await fetchScryfallCard(setCode, cardNumber);
    card = {
      CardId: key,
      setCode,
      cardNumber,
      foil: foilBool,
      amount,
      scryfall: scryfallData,
      scryfall_ttl: Date.now() + SCRYFALL_TTL_HOURS * 3600 * 1000
    };
    await dynamoDb.send(new PutCommand({
      TableName: CARDS_TABLE,
      Item: card
    }));
    res.status(201).json(card);
  } catch (err) {
    console.error('POST /:setCode/:cardNumber/:foil error:', err); // <-- Add this line
    res.status(500).json({ error: 'DynamoDB error', details: err });
  }
});

/**
 * @swagger
 * /cards/{setCode}/{cardNumber}/{foil}:
 *   patch:
 *     operationId: updateCard
 *     summary: Update card amount (protected)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: setCode
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: foil
 *         required: true
 *         schema:
 *           type: boolean
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: integer
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
router.patch('/:setCode/:cardNumber/:foil', authenticateToken, async (req, res) => {
  const { setCode, cardNumber, foil } = req.params;
  let { amount } = req.body;
  const foilBool = foil === 'true';
  amount = Number(amount);
  const key = getKey(setCode, cardNumber, foilBool);

  try {
    const result = await dynamoDb.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { CardId: key }
    }));
    let card = result.Item;
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (typeof amount !== 'undefined') {
      if (!Number.isInteger(amount)) return res.status(400).json({ error: 'Invalid amount' });
      if (amount === 0) {
        await dynamoDb.send(new DeleteCommand({
          TableName: CARDS_TABLE,
          Key: { CardId: key }
        }));
        return res.status(204).send();
      }
      card.amount = amount;
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
 * /cards/{setCode}/{cardNumber}/{foil}:
 *   delete:
 *     operationId: deleteCard
 *     summary: Delete card (protected)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: setCode
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: cardNumber
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: foil
 *         required: true
 *         schema:
 *           type: boolean
 *     responses:
 *       204:
 *         description: Card deleted
 *       404:
 *         description: Card not found
 */
// DELETE: Remove card (protected)
router.delete('/:setCode/:cardNumber/:foil', authenticateToken, async (req, res) => {
  const { setCode, cardNumber, foil } = req.params;
  const foilBool = foil === 'true';
  const key = getKey(setCode, cardNumber, foilBool);
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
