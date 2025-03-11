const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.SECRET_KEY || 'B@judit0k02018';
// Middleware to verify token
function authenticateToken(req, res, next) {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ error: 'Access Denied' });

  jwt.verify(token.replace('Bearer ', ''), SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid Token' });
    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
