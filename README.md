# Investment Planner

Personal investment tracking app with monthly goals, buy/sell allocation rules, overview status, and editable history.

## Stack

- React + Vite
- Express API
- MongoDB Atlas with Mongoose
- `.env.local` for secrets

## Local Setup

1. Install Node.js. Node 20 LTS is recommended.
2. Install dependencies:

```bash
npm install
```

3. Create `.env.local`:

```bash
cp .env.example .env.local
```

4. Add your MongoDB Atlas URI:

```env
MONGO_URL=mongodb+srv://<username>:<password>@<cluster-url>/investment-planner?retryWrites=true&w=majority
APP_PASSWORD=<a long private password>
PORT=5173
```

5. Start the app:

```bash
npm run dev
```

Then open `http://localhost:5173`.

## Keep It Running Locally

For development, `npm run dev` only stays alive while that terminal process is running.

For a longer-running local process:

```bash
npm run build
npx pm2 start npm --name investment-planner -- start
npx pm2 save
```

Useful PM2 commands:

```bash
npx pm2 status
npx pm2 logs investment-planner
npx pm2 restart investment-planner
npx pm2 stop investment-planner
```

If you restart your Mac, start it again with:

```bash
npx pm2 resurrect
```

## MongoDB Atlas Checklist

1. Sign in to MongoDB Atlas.
2. Create a project, for example `Investment Planner`.
3. Create a free cluster.
4. Create a database user and password.
5. Add a network access rule.
   - For local development, add your current IP.
   - For early testing only, `0.0.0.0/0` is convenient but less strict.
6. Copy the connection URI into `.env.local` as `MONGO_URL`.

The app uses the database name `investment-planner`.

## Google Cloud Run Deployment

This runs the app on Google Cloud instead of your Mac. MongoDB Atlas remains the database.

1. Install and sign in to the Google Cloud CLI:

```bash
gcloud auth login
```

2. Select your Google Cloud project:

```bash
gcloud config set project <your-google-cloud-project-id>
```

3. Enable the required APIs:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

If source deploy fails with a missing IAM permissions error for
`PROJECT_NUMBER-compute@developer.gserviceaccount.com`, grant the Cloud Run Builder role:

```bash
PROJECT_ID="$(gcloud config get-value project)"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.builder"
```

Wait a minute for IAM propagation, then deploy again.

If the next error says the same service account does not have `storage.objects.get`
access to the uploaded source object, grant Storage Object Viewer:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

Wait a minute for IAM propagation, then deploy again.

4. Create a local deploy env file. Do not commit this file. Cloud Run expects YAML for `--env-vars-file`:

```yaml
MONGO_URL: "mongodb+srv://<username>:<password>@<cluster-url>/investment-planner?retryWrites=true&w=majority"
APP_PASSWORD: "<a long private password>"
```

5. Deploy from this project folder:

```bash
gcloud run deploy investment-planner \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --env-vars-file .env.cloudrun
```

Cloud Run will print the service URL when deployment finishes.

Useful update command after code changes:

```bash
gcloud run deploy investment-planner \
  --source . \
  --region asia-east1 \
  --env-vars-file .env.cloudrun
```

Cloud Run provides the `PORT` environment variable automatically, so you do not need to set `PORT` in `.env.cloudrun`.

`--allow-unauthenticated` lets browsers open the site URL. The app still requires `APP_PASSWORD` before it exposes the investment API.

## Current Default Setting

When the database is empty, the app creates one 12-month time slot starting from the current Taiwan month:

- `TQQQ`: `1270 USD`
- `UPRO`: `1270 USD`
- `VT`: `317.5 USD`
- `0050`: `10000 TWD`

You can change the start/end months in Setting after first launch.
