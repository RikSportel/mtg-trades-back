const express = require('express');
const router = express.Router();
const AuthMiddleware = require('../middleware/auth');
const authenticateToken = AuthMiddleware.authenticateToken;
const { getCard, post, patch, deleteCard, getAll } = require('../controllers/cardsController');

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
router.get('/:setCode/:cardNumber', getCard);

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
 *             $ref: '#/components/schemas/Card'
 *     responses:
 *       200:
 *         description: Card updated
 *       201:
 *         description: Card created
 *       400:
 *         description: Invalid input
 */
// POST: Create or increment card (protected)
router.post('/:setCode/:cardNumber', authenticateToken, post);

// Card schema for Swagger (reusable)
const cardSchema = {
  type: 'object',
  required: ['finishes'],
  properties: {
    finishes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['finish', 'amount'],
        properties: {
          finish: {
            type: 'string',
            description: 'The finish type (e.g., "nonfoil", "foil", "etched", "glossy")'
          },
          amount: {
            type: 'integer',
            description: 'Number of copies for this finish (set to 0 to remove)'
          },
          notes: {
            type: 'string',
            description: 'Optional notes for this finish'
          }
        }
      }
    }
  }
};

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
 *             $ref: '#/components/schemas/Card'
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
router.patch('/:setCode/:cardNumber', authenticateToken, patch);
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
router.delete('/:setCode/:cardNumber', authenticateToken, deleteCard);

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
router.get('/', getAll);

/**
 * @swagger
 * /cards/batch:
 *   post:
 *     operationId: batchCards
 *     summary: Batch process card operations
 *     description: >-
 *       Accepts a batch of card operations (create, update, delete) and processes them sequentially. Each operation must specify a type (create, update, delete), setcode, cardNumber, and a body (for create/update).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [operations]
 *             properties:
 *               operations:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [type, setcode, cardNumber]
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [create, update, delete]
 *                       description: The operation type to perform.
 *                     setcode:
 *                       type: string
 *                       description: The set code of the card (e.g., "KHM")
 *                     cardNumber:
 *                       type: string
 *                       description: The card number within the set (e.g., "123")
 *                     body:
 *                       $ref: '#/components/schemas/Card'
 *     responses:
 *       200:
 *         description: Batch operation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       setcode:
 *                         type: string
 *                       cardNumber:
 *                         type: string
 *                       result:
 *                         type: object
 *       400:
 *         description: Invalid input
 */
router.post('/batch', authenticateToken, async (req, res) => {
  const { operations } = req.body;
  if (!Array.isArray(operations)) {
    return res.status(400).json({ error: 'Missing or invalid operations array.' });
  }

  const results = [];
  for (const op of operations) {
    const { type, setcode, cardNumber, body } = op;
    let result;
    // Create mock req/res objects for each operation
    const mockReq = {
      params: { setCode: setcode, cardNumber },
      body: body || {},
      user: req.user // pass auth context if needed
    };
    const mockRes = {
      status: (code) => {
        result = { status: code };
        return mockRes;
      },
      json: (data) => {
        result = { ...result, ...data };
        return result;
      },
      send: (data) => {
        result = { ...result, data };
        return result;
      }
    };
    try {
      switch (type) {
        case 'create':
          await post(mockReq, mockRes);
          break;
        case 'update':
          await patch(mockReq, mockRes);
          break;
        case 'delete':
          await deleteCard(mockReq, mockRes);
          break;
        default:
          result = { error: `Unknown operation type: ${type}` };
      }
    } catch (err) {
      result = { error: err.message };
    }
    results.push({ type, setcode, cardNumber, result });
  }
  res.json({ results });
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Finish:
 *       type: object
 *       required:
 *         - finish
 *         - amount
 *       properties:
 *         finish:
 *           type: string
 *           description: The finish type (e.g., "nonfoil", "foil", "etched", "glossy")
 *         amount:
 *           type: integer
 *           description: Number of copies for this finish
 *         notes:
 *           type: string
 *           description: Optional notes for this finish
 *     Card:
 *       type: object
 *       required:
 *         - finishes
 *       properties:
 *         finishes:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/Finish'
 */

module.exports = router;
