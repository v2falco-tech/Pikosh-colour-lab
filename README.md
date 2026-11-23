# Colouring Book Maker

Static site + one Netlify Function that makes AI images through Netlify AI Gateway
(no OpenAI/Google key needed; usage is billed to your Netlify credits).

## Deploy (GitHub route – needed because drag-and-drop doesn't include Functions)
1. Create a free account at github.com, click **New repository**, name it `colouring-book-maker`.
2. On the new repo page choose **uploading an existing file**, drag in everything from this folder
   (keep the `netlify/functions/generate.mjs` folder structure), and **Commit**.
3. At app.netlify.com: **Add new project → Import an existing project → GitHub**, pick the repo.
   Leave the build command empty and the publish directory as `.` then **Deploy**.
4. In **Project configuration → Environment variables** add `APP_PASSWORD` = any password you choose.
5. **Deploys → Trigger deploy** once more so the password is picked up.
6. Open your site, expand **AI settings**, type the same password as the access code.

AI Gateway only switches on after the first production deploy, and needs a credit-based Netlify plan
(Free works). If images stop working with a "model not found" error, set an `IMAGE_MODEL`
environment variable to another image model listed by Netlify's AI Gateway.

## Features
- Cover page with unlimited description (shrinks to fit, overflow flows onto "About this book" pages)
- AI colouring pages from a prompt, with optional reference images (up to 4 per page)
- Photo → outline (free, runs in the browser)
- Mazes, word searches, dot-to-dots, tracing, draw-your-own frames
- Reorder / duplicate / delete pages, save & reopen projects (.json)
- Download the whole book as an A4 PDF
