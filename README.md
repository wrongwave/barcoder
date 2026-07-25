# Barcoder

Lookup **ISRC** and **UPC** barcodes for Spotify and Deezer albums and tracks. Note that Spotify quotas are inhumanly tiny and it's not per app, but per developr account. Deezer requires no API key and is quite generous with quotas.

**Live:** [https://barcoder.wrongwave.net](https://barcoder.wrongwave.net)

Paste an album or track URL to get release metadata, a tracklist with ISRCs, and a copyable text summary. Links are shareable via `?url=`.

Spotify needs credentials in `config.js`. Deezer works without a key (JSONP).

## Local setup

1. [Optional] Create a [Spotify Developer](https://developer.spotify.com/dashboard) app and copy the Client ID and Client Secret — needed only if you want to support Spotify links.
2. Copy the config example and fill in your credentials:

```bash
cp config.example.js config.js
```

```js
window.BARCODER = {
	clientId: '…',
	clientSecret: '…',
}
```

3. Serve the folder over HTTP (not `file://`), e.g.:

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765`.

## Bandcamp CLI

Bandcamp has no public catalog API suitable for the web app, so lookups are a local script instead. Stdlib only — no venv or packages.

```bash
python3 bandcamp_lookup.py 'https://artist.bandcamp.com/album/…'
```

or

```bash
./bandcamp_lookup.py 'https://artist.bandcamp.com/album/…'
```

Accepts album or track URLs. Progress goes to stderr; the Barcoder-style summary (UPC, ISRCs, label, etc.) goes to stdout.

## The MIT License (MIT)
Copyright © 2026 [Wrong Wave](https://wrongwave.net)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
