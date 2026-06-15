# Classic Caller — Deployment Guide

## Backend → Render.com (free)

### Step 1: Push backend to GitHub
1. Create a new repo on github.com e.g. `classiccaller-backend`
2. In the `classiccaller-backend` folder on your computer, open terminal:
```bash
git init
git add .
git commit -m "Initial Classic Caller backend"
git remote add origin https://github.com/YOUR_USERNAME/classiccaller-backend.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to https://render.com and sign up (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub account → select `classiccaller-backend` repo
4. Fill in:
   - Name: `classiccaller-backend`
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `node start.js`
   - Plan: **Free**
5. Click **Advanced** → **Add Environment Variable** — add these one by one:

| Key | Value |
|-----|-------|
| JWT_SECRET | any long random string e.g. `myclassiccaller2024secretkey` |
| AT_USERNAME | `sandbox` |
| AT_API_KEY | your Africa's Talking API key |
| AT_CALLER_ID | your AT virtual number |
| AT_ENVIRONMENT | `sandbox` |
| DEFAULT_RATE_PER_MINUTE | `0.02` |
| FRONTEND_URL | `https://classiccaller.netlify.app` (fill after Netlify deploy) |
| BASE_URL | your Render URL e.g. `https://classiccaller-backend.onrender.com` |

6. Click **Create Web Service**
7. Render will build and deploy — wait 2-3 minutes
8. Copy your Render URL e.g. `https://classiccaller-backend.onrender.com`

### Step 3: Create the database on Render
1. On Render dashboard click **New +** → **PostgreSQL**
2. Name: `classiccaller-db`
3. Plan: **Free**
4. Click **Create Database**
5. Copy the **Internal Database URL**
6. Go back to your Web Service → **Environment** → add:
   - `DATABASE_URL` = paste the database URL
7. The migrations run automatically when the server starts

---

## Frontend → Netlify (free)

### Step 1: Update your backend URL
In `classiccaller-frontend/.env.production`:
```
VITE_API_BASE_URL=https://classiccaller-backend.onrender.com
```
(replace with your actual Render URL)

### Step 2: Push frontend to GitHub
1. Create a new repo e.g. `classiccaller-frontend`
2. Open terminal in the `classiccaller-frontend` folder:
```bash
git init
git add .
git commit -m "Initial Classic Caller frontend"
git remote add origin https://github.com/YOUR_USERNAME/classiccaller-frontend.git
git push -u origin main
```

### Step 3: Deploy on Netlify
1. Go to https://netlify.com and sign up (free)
2. Click **Add new site** → **Import an existing project**
3. Connect GitHub → select `classiccaller-frontend`
4. Fill in:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Click **Show advanced** → **New variable**:
   - Key: `VITE_API_BASE_URL`
   - Value: `https://classiccaller-backend.onrender.com`
6. Click **Deploy site**
7. Wait 1-2 minutes → your app is live!
8. Netlify gives you a URL like `https://classiccaller-abc123.netlify.app`
   - You can rename it to `classiccaller` in Site Settings → Domain

### Step 4: Update CORS on Render
Go back to Render → your backend service → Environment → update:
- `FRONTEND_URL` = `https://classiccaller.netlify.app`

### Step 5: Update Africa's Talking callback URL
In AT Dashboard → Voice → Settings → Voice Callback URL:
```
https://classiccaller-backend.onrender.com/calls/voice
```

---

## Your live URLs will be:
- Frontend: `https://classiccaller.netlify.app`
- Backend:  `https://classiccaller-backend.onrender.com`
- Health check: `https://classiccaller-backend.onrender.com/health`
