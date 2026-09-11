// Shared configuration used by App.jsx, Login.jsx, and Dashboard.jsx.
//
// AI_SERVICE_URL is read from an environment variable so the SAME code
// works locally (http://localhost:8000) and when hosted (your real
// backend's https:// URL) without ever editing source files.
//
// To set it:
//   - Local dev: create a file named ".env" in the frontend/ folder with:
//       VITE_AI_SERVICE_URL=http://localhost:8000
//   - Hosted (Vercel/Netlify/etc.): set an environment variable named
//     VITE_AI_SERVICE_URL to your deployed backend's URL, e.g.
//       VITE_AI_SERVICE_URL=https://safelight-backend.onrender.com
//
// Vite only exposes env vars that start with VITE_ to the browser.
// .replace(/\/+$/, "") strips any trailing slash(es) so URLs built like
// `${AI_SERVICE_URL}/detect` never accidentally become "...com//detect"
// (a double slash 404s on FastAPI) even if the env var was entered
// with a trailing slash by mistake.
const rawServiceUrl = import.meta.env.VITE_AI_SERVICE_URL;
export const AI_SERVICE_URL = rawServiceUrl.replace(/\/+$/, "");

export const DEVICE_ID = "PHONE-001";