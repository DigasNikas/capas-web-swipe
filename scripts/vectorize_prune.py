#!/usr/bin/env python3
"""
vectorize_prune.py — Delete vectors from a Vectorize index by cover id.

  CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
    python3 scripts/vectorize_prune.py --index headline 1825 1826 1846

The build scripts only ever add: a cover that stops qualifying keeps whatever
vector it already had. That is fine for a cover whose crowd label moved (the
label is read live from /stats now, not from the metadata), but not for one
whose *text* turned out to belong to another day — the vector then stands for
words that were never on that page, and retrieval hands it to the classifier
as a neighbour. Deleting is the only way out, since there is nothing left to
re-embed it from.

The token needs Vectorize · Edit.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

INDEXES = {
    "image": "capas-cover-embeddings",
    "headline": "capas-headline-embeddings",
}
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")


def delete_by_ids(index, ids):
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{index}/delete_by_ids",
        data=json.dumps({"ids": [str(i) for i in ids]}).encode("utf-8"),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"Vectorize refused the delete: {e.code}\n{e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", choices=sorted(INDEXES), default="headline")
    ap.add_argument("ids", nargs="+", help="cover ids, the same ids the build scripts upsert under")
    args = ap.parse_args()

    if not ACCOUNT or not TOKEN:
        print("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Vectorize · Edit).", file=sys.stderr)
        sys.exit(1)

    index = INDEXES[args.index]
    # Ids Vectorize does not hold are not an error: it reports what it removed.
    result = delete_by_ids(index, args.ids)
    print(f"{index}: asked to delete {len(args.ids)} → {json.dumps(result.get('result', result))}")


if __name__ == "__main__":
    main()
