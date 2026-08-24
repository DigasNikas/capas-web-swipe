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
// That 87% is agreement with the crowd, not correctness — at least one of the
// four "misses" ("rui costa seduz ríos") is a cover the model read right and
// the vote read wrong. Which is the point of showing both numbers on the page.
const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const CLUBS = ["benfica", "sporting", "porto", "others"];

const PROMPT =
  "This is the front page of a Portuguese sports newspaper (Record, A Bola or O Jogo). " +
  "Decide which football club the page is mostly about — the biggest headline and the main photo. " +
  "Benfica (Águias, red kit), Sporting (Leões, green-and-white stripes), " +
  "FC Porto (Dragões, blue-and-white stripes). " +
  "If the page is mostly about none of those three, answer others.\n" +
  "Quote the main headline, then on a new line write 'ANSWER: <club>' " +
  "with one of: benfica, sporting, porto, others.";

// btoa needs a binary string; spreading a 300 KB Uint8Array into
// String.fromCharCode blows the argument limit, so build it in chunks.
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Asking for the headline first measurably beats asking for the bare word —
// it makes the model actually read the page — so the answer arrives as prose
// and has to be parsed back down to one of the four keys.
export async function classifyCover(env, buffer, contentType = "image/jpeg") {
  const res = await env.AI.run(MODEL, {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${toBase64(buffer)}` } },
      ],
    }],
    max_tokens: 150,
  });

  const text = String(res?.response ?? "").toLowerCase();
  const answer = text.split("answer:").pop();
  return CLUBS.find(c => answer.includes(c)) ?? null;
}

// Never throws: a model hiccup must not take down the daily scrape, and an
// unlabelled cover is simply absent from the AI section until backfilled.
export async function classifyAndStore(env, coverId, r2Key) {
  try {
    const obj = await env.COVERS_BUCKET.get(r2Key);
    if (!obj) return null;

    const club = await classifyCover(env, await obj.arrayBuffer(), obj.httpMetadata?.contentType);
    if (!club) return null;

    await env.DB.prepare("UPDATE covers SET ai_club = ? WHERE id = ?").bind(club, coverId).run();
    return club;
  } catch (err) {
    console.error(`AI classification failed for cover ${coverId}: ${err}`);
    return null;
  }
}
