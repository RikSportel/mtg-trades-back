const jwt = require('jsonwebtoken');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretArn = process.env.JWT_PUBLIC_KEY_SECRET_ARN;
let cachedSecret = null;

async function getSecret() {
  if (cachedSecret) return cachedSecret;
  const client = new SecretsManagerClient({ region: 'eu-central-1' });
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await client.send(command);
  cachedSecret = response.SecretString;
  return cachedSecret;
}

class AuthMiddleware {
  static async authenticateToken(req, res, next) {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (!token) return res.sendStatus(401);

      const publicKey = await getSecret();
      jwt.verify(token, publicKey, { algorithms: ['RS256'] }, (err, user) => {
        if (err) return res.sendStatus(403);
        // Permission check
        if (!user.permissions || !user.permissions.includes('CARD_EDITOR')) {
          return res.status(403).json({ error: 'Missing CARD_EDITOR permission' });
        }
        req.user = user;
        next();
      });
    } catch (err) {
      console.error('JWT verification error:', err);
      res.sendStatus(500);
    }
  }
}

module.exports = AuthMiddleware;
