#!/usr/bin/env python3
"""Fetch Bandcamp album/track metadata and print Barcoder-style text.

Stdlib only. Usage:
	python3 bandcamp_lookup.py <bandcamp-album-or-track-url>
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

USER_AGENT = 'BarcoderBandcamp/1.0 (+https://barcoder.wrongwave.net; local CLI)'
REQUEST_GAP_SEC = 0.35

_status_width = 0


def status(message: str) -> None:
	"""Progress on one stderr line (\\r overwrite). Stdout stays clean for the result."""
	global _status_width
	msg = message.replace('\n', ' ').replace('\r', ' ')
	_status_width = max(_status_width, len(msg))
	# Pad so shorter messages wipe leftovers from the previous update.
	sys.stderr.write(f'\r{msg:<{_status_width}}')
	sys.stderr.flush()


def status_done() -> None:
	"""Finish the status line with a newline (if anything was written)."""
	global _status_width
	if _status_width:
		sys.stderr.write('\n')
		sys.stderr.flush()
		_status_width = 0


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description='Lookup ISRC/UPC from a Bandcamp album or track URL')
	parser.add_argument('url', help='Bandcamp album or track URL')
	args = parser.parse_args(argv)

	try:
		kind, payload = lookup(args.url.strip())
	except Exception as exc:
		status_done()
		print(f'Error: {exc}', file=sys.stderr)
		return 1

	status('Done.')
	status_done()
	text = format_track_copy(payload) if kind == 'track' else format_album_copy(payload)
	print(text)
	return 0


def lookup(url: str):
	parsed = parse_bandcamp_url(url)
	if not parsed:
		raise ValueError('Paste a Bandcamp album or track URL')

	status(f"Looking up Bandcamp {parsed['type']}…")
	if parsed['type'] == 'album':
		return 'album', fetch_album_payload(parsed['url'])
	return 'track', fetch_track_payload(parsed['url'])


def parse_bandcamp_url(raw: str):
	try:
		u = urllib.parse.urlparse(normalize_url(raw))
	except Exception:
		return None
	host = (u.hostname or '').lower()
	if 'bandcamp.com' not in host:
		return None
	parts = [p for p in u.path.split('/') if p]
	if len(parts) < 2 or parts[0] not in ('album', 'track'):
		return None
	# normalize to https without query/fragment
	clean = urllib.parse.urlunparse(('https', u.netloc.lower(), f'/{parts[0]}/{parts[1]}', '', '', ''))
	return {'type': parts[0], 'url': clean}


def normalize_url(raw: str) -> str:
	value = (raw or '').strip()
	if not value:
		return value
	if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', value):
		if value.lower().startswith('http://'):
			return 'https://' + value[7:]
		return value
	return 'https://' + value.lstrip('/')


def fetch_album_payload(album_url: str):
	status(f'Fetching album page…')
	page = fetch_page(album_url)
	tralbum = extract_tralbum(page)
	current = tralbum.get('current') or {}
	tracks_meta = tralbum.get('trackinfo') or []

	artists = current.get('artist') or bandcamp_artists_from_ld(page) or ''
	release = normalize_release_date(
		current.get('release_date') or tralbum.get('album_release_date') or ''
	)

	total = len(tracks_meta)
	status(f'Fetching ISRCs… {total} track(s)')

	rows = []
	for index, item in enumerate(tracks_meta, start=1):
		title = item.get('title') or f'track {index}'
		title_link = item.get('title_link') or ''
		track_url = urllib.parse.urljoin(album_url, title_link) if title_link else ''
		isrc = ''
		status(f'Fetching ISRCs… [{index}/{total}] {title}')
		if track_url:
			time.sleep(REQUEST_GAP_SEC)
			try:
				track_page = fetch_page(track_url)
				track_tralbum = extract_tralbum(track_page)
				isrc = (track_tralbum.get('current') or {}).get('isrc') or ''
			except Exception:
				isrc = ''

		duration_sec = float(item.get('duration') or 0)
		rows.append({
			'number': int(item.get('track_num') or 0),
			'disc': 1,
			'title': item.get('title') or '',
			'artists': item.get('artist') or artists,
			'isrc': isrc or '',
			'durationMs': int(round(duration_sec * 1000)),
			'url': track_url,
		})

	return {
		'album': current.get('title') or '',
		'artists': artists,
		'upc': current.get('upc') or '',
		'label': bandcamp_label_from_page(page),
		'catalogNumber': '',
		'releaseDate': release,
		'sourceUrl': tralbum.get('url') or album_url,
		'detailsUrl': album_url,
		'durationMs': sum(t['durationMs'] for t in rows),
		'tracks': rows,
		'focusTrackId': None,
	}


def fetch_track_payload(track_url: str):
	status('Fetching track page…')
	page = fetch_page(track_url)
	tralbum = extract_tralbum(page)
	current = tralbum.get('current') or {}

	album_path = tralbum.get('album_url') or ''
	if not album_path:
		raise ValueError('Bandcamp track has no album URL')
	album_url = urllib.parse.urljoin(track_url, album_path)

	status('Fetching album page for UPC…')
	time.sleep(REQUEST_GAP_SEC)
	album_page = fetch_page(album_url)
	album_tralbum = extract_tralbum(album_page)
	album_current = album_tralbum.get('current') or {}

	artists = (
		current.get('artist')
		or album_current.get('artist')
		or bandcamp_artists_from_ld(album_page)
		or ''
	)
	release = normalize_release_date(
		album_current.get('release_date')
		or album_tralbum.get('album_release_date')
		or current.get('release_date')
		or ''
	)

	duration_ms = 0
	for item in tralbum.get('trackinfo') or []:
		if item.get('id') == current.get('id') or item.get('track_id') == current.get('id'):
			duration_ms = int(round(float(item.get('duration') or 0) * 1000))
			break
	if not duration_ms:
		duration_ms = duration_ms_from_ld(page)

	track = {
		'number': int(current.get('track_number') or 0),
		'disc': 1,
		'title': current.get('title') or '',
		'artists': artists,
		'isrc': current.get('isrc') or '',
		'id': str(current.get('id') or ''),
		'durationMs': duration_ms,
		'url': track_url,
	}

	return {
		'album': album_current.get('title') or '',
		'artists': album_current.get('artist') or artists,
		'upc': album_current.get('upc') or '',
		'label': bandcamp_label_from_page(album_page),
		'catalogNumber': '',
		'releaseDate': release,
		'sourceUrl': album_tralbum.get('url') or album_url,
		'detailsUrl': track_url,
		'durationMs': duration_ms,
		'tracks': [track],
		'focusTrackId': track['id'],
	}


def fetch_page(url: str) -> str:
	req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html'})
	try:
		with urllib.request.urlopen(req, timeout=30) as resp:
			return resp.read().decode('utf-8', 'replace')
	except urllib.error.HTTPError as exc:
		raise RuntimeError(f'Bandcamp HTTP {exc.code} for {url}') from exc
	except urllib.error.URLError as exc:
		raise RuntimeError(f'Could not fetch {url}: {exc.reason}') from exc


def extract_tralbum(page_html: str) -> dict:
	match = re.search(r'data-tralbum="([^"]+)"', page_html)
	if not match:
		raise RuntimeError('Could not find Bandcamp data-tralbum JSON on page')
	return json.loads(html_lib.unescape(match.group(1)))


def bandcamp_artists_from_ld(page_html: str) -> str:
	for match in re.finditer(
		r'<script type="application/ld\+json">(.*?)</script>',
		page_html,
		re.S,
	):
		try:
			data = json.loads(match.group(1))
		except json.JSONDecodeError:
			continue
		if not isinstance(data, dict):
			continue
		by = data.get('byArtist')
		if isinstance(by, dict) and by.get('name'):
			return str(by['name'])
		if isinstance(by, list):
			names = [a.get('name') for a in by if isinstance(a, dict) and a.get('name')]
			if names:
				return ', '.join(names)
	return ''


def bandcamp_label_from_page(page_html: str) -> str:
	"""Label lives outside data-tralbum — prefer JSON-LD recordLabel, then page chrome."""
	for match in re.finditer(
		r'<script type="application/ld\+json">(.*?)</script>',
		page_html,
		re.S,
	):
		try:
			data = json.loads(match.group(1))
		except json.JSONDecodeError:
			continue
		if not isinstance(data, dict):
			continue
		releases = data.get('albumRelease')
		if isinstance(releases, dict):
			releases = [releases]
		if isinstance(releases, list):
			for release in releases:
				if not isinstance(release, dict):
					continue
				label = release.get('recordLabel')
				if isinstance(label, dict) and label.get('name'):
					return str(label['name']).strip()
				if isinstance(label, list):
					for entry in label:
						if isinstance(entry, dict) and entry.get('name'):
							return str(entry['name']).strip()

	# "← more from Claremont 56" back-to-label link
	link = re.search(
		r'class="back-to-label-link"[^>]*>.*?<span class="back-link-text">[^<]*<br\s*/?\s*>([^<]+)</span>',
		page_html,
		re.S | re.I,
	)
	if link:
		return html_lib.unescape(link.group(1)).strip()

	# Label pages set mailing_list_info.label_name — do not use item_sellers
	# (that is often just the artist band name, e.g. "alvisk").
	blob_match = re.search(r'id="pagedata"\s+data-blob="([^"]+)"', page_html)
	if blob_match:
		try:
			blob = json.loads(html_lib.unescape(blob_match.group(1)))
		except json.JSONDecodeError:
			blob = None
		if isinstance(blob, dict):
			info = ((blob.get('signup_params') or {}).get('mailing_list_info') or {})
			name = info.get('label_name')
			if name:
				return str(name).strip()

	return ''


def duration_ms_from_ld(page_html: str) -> int:
	for match in re.finditer(
		r'<script type="application/ld\+json">(.*?)</script>',
		page_html,
		re.S,
	):
		try:
			data = json.loads(match.group(1))
		except json.JSONDecodeError:
			continue
		if not isinstance(data, dict):
			continue
		iso = data.get('duration')
		if isinstance(iso, str) and iso.startswith('P'):
			return parse_iso_duration_ms(iso)
	return 0


def parse_iso_duration_ms(iso: str) -> int:
	# Bandcamp uses forms like P00H04M54S
	match = re.match(r'P(?:(\d+)D)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$', iso)
	if not match:
		return 0
	days, hours, minutes, seconds = match.groups()
	total = (
		(int(days or 0) * 24 + int(hours or 0)) * 60
		+ int(minutes or 0)
	) * 60 + float(seconds or 0)
	return int(round(total * 1000))


def normalize_release_date(raw: str) -> str:
	raw = (raw or '').strip()
	if not raw:
		return ''
	# "24 Mar 2024 00:00:00 GMT" — %Z is unreliable; strip timezone name
	cleaned = re.sub(r'\s+[A-Z]{2,5}$', '', raw)
	for fmt in ('%d %b %Y %H:%M:%S', '%d %b %Y', '%Y-%m-%d'):
		try:
			return datetime.strptime(cleaned, fmt).strftime('%Y-%m-%d')
		except ValueError:
			continue
	return raw


def format_duration(ms: int) -> str:
	total_sec = int(round((ms or 0) / 1000))
	hours = total_sec // 3600
	minutes = (total_sec % 3600) // 60
	seconds = total_sec % 60
	if hours > 0:
		return f'{hours}:{minutes:02d}:{seconds:02d}'
	return f'{minutes}:{seconds:02d}'


def format_track_copy(payload: dict) -> str:
	track = payload['tracks'][0]
	lines = [
		f"Track: {track.get('title') or ''}",
		f"Artist(s): {track.get('artists') or payload.get('artists') or ''}",
		f"ISRC: {track.get('isrc') or ''}",
		f"Length: {format_duration(track.get('durationMs') or 0)}",
		'',
		f"Album: {payload.get('album') or ''}",
		f"Album artist(s): {payload.get('artists') or ''}",
		f"UPC: {payload.get('upc') or ''}",
		f"Label: {payload.get('label') or ''}",
		f"Release: {payload.get('releaseDate') or ''}",
		f"Track #: {track.get('number') or ''}",
	]
	return '\n'.join(lines)


def format_album_copy(payload: dict) -> str:
	lines = [
		f"Album: {payload.get('album') or ''}",
		f"Artist(s): {payload.get('artists') or ''}",
		f"UPC: {payload.get('upc') or ''}",
		f"Length: {format_duration(payload.get('durationMs') or 0)}",
		f"Label: {payload.get('label') or ''}",
		f"Release: {payload.get('releaseDate') or ''}",
		'',
	]

	tracks = payload.get('tracks') or []
	rows = [
		['#', 'Title', 'Length', 'ISRC'],
		*[
			[
				str(t.get('number') or ''),
				t.get('title') or '',
				format_duration(t.get('durationMs') or 0),
				t.get('isrc') or '',
			]
			for t in tracks
		],
	]
	widths = [max(len(str(row[col])) for row in rows) for col in range(4)]

	def pad_cell(text: str, width: int, align: str) -> str:
		gap = max(0, width - len(text))
		if align == 'right':
			return (' ' * gap) + text
		return text + (' ' * gap)

	for row in rows:
		lines.append(
			'  '.join(
				pad_cell(str(cell), widths[col], 'right' if col in (0, 2) else 'left')
				for col, cell in enumerate(row)
			)
		)

	return '\n'.join(lines)


if __name__ == '__main__':
	sys.exit(main())
