# PrintFit

PrintFit arranges photos into space-efficient A4 sheets and exports a print-ready PDF. All image decoding, layout search, rendering, and PDF generation happen locally in the browser—photos are never uploaded.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

Push this folder to a Git repository and import it in Vercel. Vercel detects Vite automatically; the default `npm run build` command and `dist` output directory are correct. No environment variables or server functions are needed.

You can also deploy from the CLI:

```bash
npx vercel
```

## How the layout works

Each page is treated as a slicing floorplan rather than a fixed grid. The optimizer generates and scores thousands of seeded horizontal/vertical arrangements, minimizing A4 boundary waste while penalizing large differences in photo area. Photos are uniformly scaled, never cropped or stretched, and partial final pages respect the selected target photo size.
