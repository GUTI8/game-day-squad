# Deployment notes

Personal reference for hosting this project.

## Run locally

Double-click `index.html`.

## Deploy free on GitHub Pages

1. Create a new **public** repository on GitHub, e.g. `game-day-squad`.
2. Upload these files: click **Add file → Upload files**, drag the whole folder contents in, then click **Commit**. If you prefer git:
   ```bash
   git init
   git add .
   git commit -m "Game Day Squad"
   git branch -M main
   git remote add origin https://github.com/<your-username>/game-day-squad.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`. Click **Save**.
4. After a minute or two the site is live at
   `https://<your-username>.github.io/game-day-squad/`

Any later change you push goes live automatically.

## Option: Cloudflare Pages with access control

To keep the code public on GitHub for your portfolio but only let approved people use the live app:

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Framework preset: **None**. Leave the build command empty and set the output directory to `/`. Deploy. You get a `*.pages.dev` address.
3. Go to **Zero Trust → Access → Applications → Add an application → Self-hosted**. Enter the `*.pages.dev` domain and add a policy that **allows** specific email addresses (e.g. the coach's).
4. Visitors get a one-time code by email before the app opens. The free Zero Trust plan covers up to 50 users.

Every push to GitHub redeploys automatically. Dashboard labels change from time to time, so the names above may differ slightly.
