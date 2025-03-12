const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.SECRET_KEY || 'B@judit0k02018';

// Middleware to verify token

function authenticateToken(req, res, next) {
  const token = req.cookies.auth_token; // Get token from cookie

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token is invalid' });
    }
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
