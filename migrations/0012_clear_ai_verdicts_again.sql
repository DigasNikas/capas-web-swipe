-- Clear the 50 verdicts produced between 0011 and the prompt change below, so
-- the archive is labelled by one prompt rather than two.
--
-- The change: a page shared evenly by two of the three clubs is `others`. The
-- crowd has always labelled it that way — A Bola's "BAILINHO", Leandro on one
-- side and Suárez on the other after both clubs won in Madeira, is the clearest
-- case — but the prompt only ever asked which club's photo was largest, so the
-- model answered with one of them every time. 8 of the first 50 covers it
-- classified were exactly this, and `others` recall was 1 of 9.
UPDATE covers SET
  ai_club       = NULL,
  ai_headline   = NULL,
  ai_why        = NULL,
  ai_rag_covers = NULL,
  ai_rag_source = NULL,
  ai_source     = NULL;
