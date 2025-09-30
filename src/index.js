const express = require('express');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { fetchScryfallCard } = require('./middleware/scryfall');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const app = express();
app.use(cors());
app.use(express.json());
const port = 8080;

// Helper to fetch public key from AWS Secrets Manager
const publicKeyArn = process.env.JWT_PUBLIC_KEY_SECRET_ARN;
let cachedPublicKey = null;
async function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const client = new SecretsManagerClient({ region: 'eu-central-1' });
  const command = new GetSecretValueCommand({ SecretId: publicKeyArn });
  const response = await client.send(command);
  cachedPublicKey = response.SecretString;
  return cachedPublicKey;
}

// Helper to fetch private key from AWS Secrets Manager
const privateKeyArn = process.env.JWT_PRIVATE_KEY_SECRET_ARN;
let cachedPrivateKey = null;
async function getPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;
  const client = new SecretsManagerClient({ region: 'eu-central-1' });
  const command = new GetSecretValueCommand({ SecretId: privateKeyArn });
  const response = await client.send(command);
  cachedPrivateKey = response.SecretString;
  return cachedPrivateKey;
}

// Helper to fetch credentials from AWS Secrets Manager
const credentialsArn = process.env.JWT_CREDENTIALS_SECRET_ARN;
let cachedCredentials = null;
async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const client = new SecretsManagerClient({ region: 'eu-central-1' });
  const command = new GetSecretValueCommand({ SecretId: credentialsArn });
  const response = await client.send(command);
  cachedCredentials = JSON.parse(response.SecretString);
  return cachedCredentials;
}

// Endpoint to generate a JWT token for testing
app.get('/gettoken', async (req, res) => {
  // Basic Auth check
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Missing basic auth' });
  }
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');
  try {
    const secret = await getCredentials();
    if (username !== secret.username || password !== secret.password) {
      return res.status(403).json({ error: 'Invalid credentials' });
    }
    const jwtUsername = secret.username;
    const privateKey = await getPrivateKey();
    const token = jwt.sign(
      { username: jwtUsername, permissions: ['CARD_EDITOR'] },
      privateKey,
      { expiresIn: '1h', algorithm: 'RS256' }
    );
    res.json({ token });
  } catch (err) {
    console.error('Error generating token:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Cards RESTful API
const cardsRouter = require('./routes/cards');
app.use('/cards', cardsRouter);

app.get('/card/:setCode/:cardNumber', async (req, res) => {
  const { setCode, cardNumber } = req.params;
  const cardData = await fetchScryfallCard(setCode, cardNumber);
  res.send(cardData || { error: 'Card not found' });
});

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MTG Trades API',
      version: '1.0.0',
      description: 'API documentation for MTG Trades backend',
    },
  },
  apis: ['./src/routes/*.js'], // Path to your route files
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Serve raw swagger spec as JSON
app.get('/api-docs/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

//app.listen(port, () => {
//  console.log(`MTG backend listening on port ${port}`);
//});
mosdule.exports = app;
