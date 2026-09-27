# BirdTrainer

Practise identifying birds from photos and sounds pulled live from [iNaturalist](https://www.inaturalist.org).
It's a static site (plain HTML/CSS/JS, no build step) that calls the public iNaturalist API from the browser.

## Features

- **Filter by place** (any iNaturalist place: countries, states, counties, parks…) and optionally by **month**.
- **Filter by taxon**: families, genera, species, or informal / polyphyletic **groups** such as gulls,
  raptors, shorebirds, "warblers" or "sparrows". Build and save your own groups, and exclude taxa.
- **Photos, sounds, or both.** Every question draws a random research-grade observation, so you see many
  different photos and recordings of each species. Dead birds and feathers are skipped.
- **Hints on demand**: location, date, age / life stage and sex (when annotated on iNaturalist), family,
  genus, first letter, another observation, and "hear it" / "see it" in the other medium.
- **Multiple choice** (2–8 options; wrong options can be similar birds from the same genus/family) or **typed answers**.
- **Spaced practice**: species you miss come back sooner; ones you know well show up less. Progress is saved
  in your browser.
- A **Species** tab listing everything that matches your filters.

## Run locally

Any static file server works, e.g.

```sh
npx http-server .
# or
python3 -m http.server
```

then open http://localhost:8080 (or :8000). Opening `index.html` directly from disk won't work because ES modules need http.

## Deploy to GitHub Pages

1. Merge this branch into `main`.
2. In the repository go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick **`main`** and **`/ (root)`**, and save.
4. After a minute the site is live at `https://lfrolund.github.io/BirdTrainer/`.

## Notes

- Photos and recordings belong to their observers and are shown with their license attribution.
- Requests are throttled to stay within iNaturalist's API rate limits.
