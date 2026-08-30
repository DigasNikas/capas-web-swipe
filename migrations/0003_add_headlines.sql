-- Real scraped headline text from capasjornais.pt's "Títulos da Capa"
-- block (see api/lib/scraper.js's extractHeadlinesFromHtml), not the
-- AI-generated ai_headline. Forward-only: that page has no date
-- parameter, always shows today's edition, so scrapeNewspaper only ever
-- populates this for the day the scrape actually runs on. Every existing
-- row stays NULL; no backfill attempted here.
ALTER TABLE covers ADD COLUMN headlines TEXT;
