// Zero-shot cover classification. No training, no fine-tuning — the model is
// asked to read the front page and name the club it is about.
//
// Benchmarked against 30 randomly sampled crowd-labelled covers:
//   @cf/meta/llama-4-scout-17b-16e-instruct     87%  (full-res)
//   @cf/meta/llama-3.2-11b-vision-instruct      67%  (full-res, same prompt)
//   @cf/meta/llama-3.2-11b-vision-instruct      53%  (220px thumbnail)
// Resolution and headline-reading are what decide it: most covers are called
// by the Portuguese text, not by kit colours, so the thumbnails used elsewhere
// on the site are not good enough input and the full-res original is fetched.
//
// That 30-cover sample flattered it. Scored over the whole archive the first
// prompt agreed with the crowd on 77% (447/579), and the misses were lopsided:
//   others  → big three   67 of 132 misses    (others recall 39%)
//   benfica → sporting    22                  (benfica recall 76%)
// It over-called Sporting (+36% against the true count) and Porto (+33%), and
// under-called Benfica (−21%) and others (−51%). Three causes, all addressed
// below: the parser guessed instead of abstaining, every one of these front
// pages carries small SPORTING / FC PORTO boxes down the rails, and "red kit"
// is a useless Benfica cue when Record and A Bola print their masthead in red.
//
// Score with scripts/eval-ai.mjs before and after touching PROMPT. Changing it
// by eye and hoping is how the numbers above happened.
export const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

export const CLUBS = ["benfica", "sporting", "porto", "others"];

// Names over colours: at full resolution the model reads the page, and the club
// names and nicknames are unambiguous where the palette is not.
export const PROMPT =
  "You are looking at the front page of a Portuguese sports daily (Record, A Bola or O Jogo).\n" +
  "Find the largest photo on the page — the one that takes up most of the visible space. To work " +
  "out which club it shows, use everything printed with that photo: the shirt colours and faces in " +
  "it, plus any score line, caption or headline printed right next to or under it — all of that " +
  "belongs to the photo. Then read that photo's own headline, the text printed next to or under it, " +
  "for your HEADLINE line.\n" +
  "\n" +
  "A page is dominated by whichever club's photo and its surrounding text together occupy the most " +
  "space, pushing everything else into smaller boxes, strips and corners. A headline can read as " +
  "dramatic or sit near the top of the page and still not be the dominant story — if it sits over a " +
  "small photo or no photo at all, the large photo elsewhere on the page is what the cover is about.\n" +
  "\n" +
  "Ignore these. They are on every edition and say nothing about the day:\n" +
  "- the newspaper's own masthead and its colour (Record and A Bola are red; that is branding, not Benfica)\n" +
  "- the small section boxes and side rails headed SPORTING, FC PORTO or BENFICA — these are separate " +
  "from the largest photo, not printed with it\n" +
  "- teasers, adverts, cartoons and results bars along the edges\n" +
  "- small headline strips over a small photo or no photo, even near the top of the page\n" +
  "\n" +
  "How the clubs are named on these pages:\n" +
  "- benfica: Benfica, SLB, Aguias, Encarnados, da Luz\n" +
  "- sporting: Sporting, SCP, Leoes, Alvalade, verde-e-brancos\n" +
  "- porto: FC Porto, FCP, Dragoes, Dragao, azuis-e-brancos\n" +
  "- others: the main story is none of those three — the Portugal national team, " +
  "Braga, Guimaraes or another club, another sport (cycling, futsal), " +
  "or a transfer round-up with no single club on top\n" +
  "\n" +
  "Reply in exactly three lines:\n" +
  "HEADLINE: <the headline belonging to the largest photo, copied>\n" +
  "WHY: <the one detail that decided it — a name, nickname or kit colour word from that photo, its " +
  "score line or caption, or its headline>\n" +
  "ANSWER: <benfica|sporting|porto|others>";

// btoa needs a binary string; spreading a 300 KB Uint8Array into
// String.fromCharCode blows the argument limit, so build it in chunks.
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Strict on purpose. The old parser fell back to scanning the whole reply when
// the ANSWER: marker was missing, and then picked whichever club came first in
// CLUBS rather than first in the text — so "not Benfica, this is Sporting"
// parsed as benfica, and a reply truncated before the marker still produced a
// confident label. An unreadable reply is now no label: ai_club stays NULL and
// the next backfill pass retries the cover.
export function parseAnswer(text) {
  const raw = String(text ?? "");
  const lower = raw.toLowerCase();
  const marker = lower.lastIndexOf("answer:");
  if (marker === -1) return { club: null, headline: null, why: null };

  const tail = lower.slice(marker + "answer:".length);
  let club = null;
  let at = Infinity;
  for (const c of CLUBS) {
    const i = tail.indexOf(c);
    if (i !== -1 && i < at) { at = i; club = c; }
  }

  // What the model says it read, and why it landed on that club. Stored so a
  // wrong label can be diagnosed with one SQL query instead of by opening the
  // image and guessing what it saw.
  const before = raw.slice(0, marker);
  const head = before.match(/headline:\s*(.+)/i);
  const why = before.match(/why:\s*(.+)/i);
  return {
    club,
    headline: head ? head[1].trim().slice(0, 200) : null,
    why: why ? why[1].trim().slice(0, 200) : null,
  };
}

// How many similar past covers scripts/rag_classify.py pulls as few-shot
// context. Small on purpose: enough to show a majority signal, small enough
// not to crowd out the actual instructions.
export const RAG_TOP_K = 5;

// Turns Vectorize matches into a short few-shot block, or "" if there's
// nothing usable. The caveat line matters: image-embeddings.md's own
// findings show raw CLIP similarity tracks newspaper layout as much as
// subject, so this must read as a weak prior, not a verdict, or the model
// will over-trust it.
//
// The Worker has no way to embed an image itself (no CLIP model in Workers
// AI, and no live embedding service — see rag.md for why), so this runs
// outside the Worker entirely: scripts/rag_classify.py computes the
// embedding and the Vectorize query in Python, builds the identical block
// (its own copy of this exact wording — keep both in sync by hand), and
// POSTs the finished text to /reclassify-rag, which threads it into
// classifyCover below as the fewShot parameter. This JS copy stays mainly
// as the source-of-truth wording and for its test coverage.
export function buildFewShotBlock(matches) {
  // A cover already in the index matches itself at ~0.99999 — dropping the
  // near-identical hit is what keeps a re-classified cover from being handed
  // its own crowd vote (both rag_classify.py's live and --eval modes
  // re-embed covers that are already indexed).
  const clubs = (matches ?? []).filter(m => (m.score ?? 0) < 0.999).map(m => m.metadata?.club).filter(Boolean);
  if (!clubs.length) return "";

  return (
    `Reference: ${clubs.length} visually similar past front pages from this archive ` +
    `were crowd-labelled: ${clubs.join(", ")}. Visual similarity here tracks newspaper ` +
    "layout as much as subject matter — treat this only as a weak prior, not a verdict.\n\n"
  );
}

// Same filter as buildFewShotBlock above (score < 0.999, has a club), kept
// as a separate pass rather than returned alongside the text so a caller
// that only wants the prompt block (classifyCover's callers) doesn't have
// to thread ids through code that has no use for them. Vectorize's own
// match id is the cover_id: build_vectorize_index.py upserts each vector
// with `id: str(cover_id)`. Keep in sync with rag_cover_ids_from_matches
// in scripts/rag_classify.py by hand, same as buildFewShotBlock's wording.
export function ragCoverIdsFromMatches(matches) {
  return (matches ?? [])
    .filter(m => (m.score ?? 0) < 0.999 && m.metadata?.club)
    .map(m => m.id);
}

// fewShot is a pre-built block (see buildFewShotBlock above), computed
// upstream in scripts/rag_classify.py and threaded through /reclassify-rag —
// this function itself never touches Vectorize or does any embedding. It
// comes back "" only when no similar covers were found yet, which still
// classifies the cover, just without RAG context (see ai-detector.md).
export async function classifyCover(env, buffer, contentType = "image/jpeg", fewShot = "") {
  const res = await env.AI.run(MODEL, {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: fewShot + PROMPT },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${toBase64(buffer)}` } },
      ],
    }],
    // 150 could run out mid-headline and never reach ANSWER:, which under the
    // old parser became a guess. Output tokens are noise next to a full-res
    // image, so there is no reason to be tight here.
    max_tokens: 300,
    temperature: 0.2,
  });

  return parseAnswer(res?.response);
}

// Never throws: called from /reclassify-rag, an admin request that must not
// blow up on one bad cover, and an unlabelled cover is simply absent from the
// AI section until the next rag-classify.yml run retries it.
// fewShot: see classifyCover above. ragCoverIds: the cover_ids the fewShot
// block was built from (see ragCoverIdsFromMatches above), stored purely for
// provenance — nothing reads ai_rag_covers back to build a prompt, it exists
// so a bad classification can be traced to the covers that biased it instead
// of re-deriving them by hand.
export async function classifyAndStore(env, coverId, r2Key, fewShot = "", ragCoverIds = []) {
  try {
    const obj = await env.COVERS_BUCKET.get(r2Key);
    if (!obj) return null;

    const { club, headline, why } = await classifyCover(env, await obj.arrayBuffer(), obj.httpMetadata?.contentType, fewShot);
    if (!club) return null;

    await env.DB
      .prepare("UPDATE covers SET ai_club = ?, ai_headline = ?, ai_why = ?, ai_rag_covers = ? WHERE id = ?")
      // Empty string, not null: ai_headline/ai_why being NULL is what marks a
      // cover as classified by an older prompt and puts it back in the
      // backfill queue. ai_rag_covers carries no such meaning, "[]" for no
      // RAG context is just as valid a stored value as a populated array.
      .bind(club, headline ?? "", why ?? "", JSON.stringify(ragCoverIds ?? []), coverId)
      .run();
    return club;
  } catch (err) {
    console.error(`AI classification failed for cover ${coverId}: ${err}`);
    return null;
  }
}
