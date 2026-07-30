// Vercel serverless entry point. All route/business logic lives in
// server/app.js (shared with the local/Render entry, server/index.js) - this
// file only adapts it to the Node.js Vercel Function handler signature.
import app from '../server/app.js';

export default function handler(req, res) {
  return app(req, res);
}

// Vercel's Node.js runtime otherwise pre-consumes the request body itself
// (to populate its own req.body helper) before this handler ever runs,
// leaving nothing for Express's express.json() middleware to read -
// every POST/PUT with a JSON body would 500 with "stream is not readable".
export const config = {
  api: {
    bodyParser: false,
  },
};
