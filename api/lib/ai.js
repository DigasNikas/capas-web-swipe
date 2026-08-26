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
  "Name the football club the page is MOSTLY about — the dominant headline and the main photo, " +
  "the story that fills the page.\n" +
  "\n" +
  "Ignore these. They are on every edition and say nothing about the day:\n" +
  "- the newspaper's own masthead and its colour (Record and A Bola are red; that is branding, not Benfica)\n" +
  "- small boxes and side rails for a DIFFERENT, separate story elsewhere on the page — even one headed SPORTING, FC PORTO or BENFICA\n" +
  "- teasers, adverts, cartoons and results bars along the edges\n" +
  "\n" +
  "Many covers lead with a person, not a club name: a player, coach, president or agent, in a " +
  "transfer, quote, or injury story. That story is still about a specific club — it is not " +
  "'others' just because the headline itself is only a name. Read the subheadline, caption, or a " +
  "page-reference tag ('BENFICA P.2 a 4') sitting right next to that same headline or photo; it " +
  "usually names the club the person is joining, leaving, managing, or playing for. Answer " +
  "'others' only when nothing in that main story's own text names a club.\n" +
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
  "HEADLINE: <the biggest headline, copied>\n" +
  "WHY: <the one detail that decided it — a name, nickname, kit colour word, or the club named next to the main story>\n" +
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

export async function classifyCover(env, buffer, contentType = "image/jpeg") {
  const res = await env.AI.run(MODEL, {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: PROMPT },
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

// Never throws: a model hiccup must not take down the daily scrape, and an
// unlabelled cover is simply absent from the AI section until backfilled.
export async function classifyAndStore(env, coverId, r2Key) {
  try {
    const obj = await env.COVERS_BUCKET.get(r2Key);
    if (!obj) return null;

    const { club, headline, why } = await classifyCover(env, await obj.arrayBuffer(), obj.httpMetadata?.contentType);
    if (!club) return null;

    await env.DB
      .prepare("UPDATE covers SET ai_club = ?, ai_headline = ?, ai_why = ? WHERE id = ?")
      // Empty string, not null: ai_headline/ai_why being NULL is what marks a
      // cover as classified by an older prompt and puts it back in the
      // backfill queue.
      .bind(club, headline ?? "", why ?? "", coverId)
      .run();
    return club;
  } catch (err) {
    console.error(`AI classification failed for cover ${coverId}: ${err}`);
    return null;
  }
}
