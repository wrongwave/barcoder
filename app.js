const form = document.getElementById('lookup-form')
const input = document.getElementById('url-input')
const statusEl = document.getElementById('status')
const resultsEl = document.getElementById('results')
const metaEl = document.getElementById('meta')
const tracksBody = document.getElementById('tracks-body')
const albumBtn = document.getElementById('album-btn')
const shareBtn = document.getElementById('share-btn')
const copyBtn = document.getElementById('copy-btn')
const copyDialog = document.getElementById('copy-dialog')
const copyDialogHint = document.getElementById('copy-dialog-hint')
const copyDialogText = document.getElementById('copy-dialog-text')

const URL_PARAM = 'url'
const canNativeShare = typeof navigator.share === 'function'
const shareBtnLabel = canNativeShare ? 'Share' : 'Copy link'
shareBtn.textContent = shareBtnLabel

let spotifyToken = null
let tokenExpiry = 0
let lastPayload = null

form.addEventListener('submit', async (event) => {
	event.preventDefault()
	const url = input.value.trim()
	if (!url) return
	setLocationUrl(url)
	await lookup(url)
})

shareBtn.addEventListener('click', async () => {
	if (!lastPayload) return

	const link = location.href
	const shareData = {
		title: `${lastPayload.album} — ${lastPayload.artists}`,
		text: `ISRC / UPC for ${lastPayload.album}`,
		url: link,
	}

	if (canNativeShare) {
		try {
			if (!navigator.canShare || navigator.canShare(shareData)) {
				await navigator.share(shareData)
				return
			}
		} catch (error) {
			if (error?.name === 'AbortError') return
		}
	}

	await copyOrShow(link, {
		button: shareBtn,
		okStatus: 'Link copied',
		dialogHint: 'Clipboard blocked — select and copy this link:',
	})
})

copyBtn.addEventListener('click', async () => {
	if (!lastPayload) return
	await copyOrShow(formatCopyText(lastPayload), {
		button: copyBtn,
		dialogHint: 'Clipboard blocked — select and copy this text:',
	})
})

async function copyOrShow(text, { button, okStatus, dialogHint }) {
	try {
		await navigator.clipboard.writeText(text)
		if (button) flashButtonLabel(button, 'Copied')
		if (okStatus) {
			setStatus(okStatus)
			setTimeout(() => {
				if (statusEl.textContent === okStatus) setStatus('')
			}, 2000)
		}
	} catch {
		showCopyDialog(text, dialogHint || 'Select and copy:')
	}
}

function showCopyDialog(text, hint) {
	copyDialogHint.textContent = hint
	copyDialogText.value = text
	copyDialog.showModal()
	const selectAll = () => {
		copyDialogText.focus()
		copyDialogText.select()
		copyDialogText.setSelectionRange(0, copyDialogText.value.length)
		copyDialogText.scrollTop = copyDialogText.scrollHeight
		copyDialog.querySelector('button[type=submit]')?.scrollIntoView({
			block: 'nearest',
			inline: 'nearest',
		})
	}
	requestAnimationFrame(selectAll)
	setTimeout(selectAll, 50)
}

function flashButtonLabel(button, label) {
	const oldLabel = button.textContent
	button.textContent = label
	setTimeout(() => {
		button.textContent = oldLabel
	}, 1200)
}

window.addEventListener('popstate', () => {
	const url = getLocationUrl()
	input.value = url
	if (url) lookup(url)
	else clearResults()
})

const initialUrl = getLocationUrl()
if (initialUrl) {
	input.value = initialUrl
	lookup(initialUrl)
}

function getLocationUrl() {
	return new URLSearchParams(location.search).get(URL_PARAM)?.trim() || ''
}

function setLocationUrl(spotifyUrl) {
	const next = new URL(location.href)
	if (spotifyUrl) next.searchParams.set(URL_PARAM, spotifyUrl)
	else next.searchParams.delete(URL_PARAM)
	const href = next.pathname + next.search + next.hash
	if (href !== location.pathname + location.search + location.hash) {
		history.pushState(null, '', href)
	}
}

function clearResults() {
	lastPayload = null
	resultsEl.hidden = true
	tracksBody.innerHTML = ''
	metaEl.innerHTML = ''
	albumBtn.hidden = true
	albumBtn.removeAttribute('href')
	shareBtn.disabled = true
	copyBtn.disabled = true
	setStatus('')
}

function credentials() {
	const cfg = window.BARCODER || {}
	return {
		clientId: cfg.clientId || '',
		clientSecret: cfg.clientSecret || '',
	}
}

async function lookup(url) {
	setStatus('Looking up…')
	resultsEl.hidden = true
	lastPayload = null
	albumBtn.hidden = true
	shareBtn.disabled = true
	copyBtn.disabled = true

	try {
		const { clientId, clientSecret } = credentials()
		if (!clientId || !clientSecret) {
			throw new Error('Add Spotify clientId and clientSecret to config.js')
		}

		const parsed = parseSpotifyUrl(url)
		if (!parsed) {
			throw new Error('Paste a Spotify album or track URL')
		}

		const token = await getToken(clientId, clientSecret)
		const payload = parsed.type === 'album'
			? await fetchAlbumPayload(token, parsed.id)
			: await fetchTrackPayload(token, parsed.id)

		lastPayload = payload
		render(payload)
		setStatus('')
		shareBtn.disabled = false
		copyBtn.disabled = false
	} catch (error) {
		setStatus(error.message || 'Lookup failed', true)
	}
}

function parseSpotifyUrl(raw) {
	const value = raw.trim()
	const uri = value.match(/^spotify:(album|track):([A-Za-z0-9]+)$/)
	if (uri) return { type: uri[1], id: uri[2] }

	try {
		const u = new URL(value)
		if (!u.hostname.includes('spotify.com')) return null
		const parts = u.pathname.split('/').filter(Boolean)
		const typeIndex = parts.findIndex((p) => p === 'album' || p === 'track')
		if (typeIndex === -1 || !parts[typeIndex + 1]) return null
		return {
			type: parts[typeIndex],
			id: parts[typeIndex + 1].split('?')[0],
		}
	} catch {
		return null
	}
}

async function getToken(clientId, clientSecret) {
	if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken

	const response = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	})

	if (!response.ok) {
		throw new Error(`Could not authenticate with Spotify (${response.status})`)
	}

	const data = await response.json()
	spotifyToken = data.access_token
	tokenExpiry = Date.now() + data.expires_in * 1000 - 60_000
	return spotifyToken
}

async function spotifyGet(token, path) {
	const response = await fetch(`https://api.spotify.com/v1${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (!response.ok) {
		throw new Error(`Spotify API error (${response.status})`)
	}
	return response.json()
}

async function fetchAlbumPayload(token, albumId) {
	const album = await spotifyGet(token, `/albums/${albumId}`)
	const trackIds = await collectAlbumTrackIds(token, album)
	const tracks = await fetchTracksByIds(token, trackIds)
	return buildPayload(album, tracks)
}

async function fetchTrackPayload(token, trackId) {
	const track = await spotifyGet(token, `/tracks/${trackId}`)
	const album = await spotifyGet(token, `/albums/${track.album.id}`)
	return buildPayload(album, [track], { focusTrackId: track.id })
}

async function collectAlbumTrackIds(token, album) {
	const ids = []
	let next = album.tracks?.next || null

	for (const item of album.tracks?.items || []) {
		if (item?.id) ids.push(item.id)
	}

	while (next) {
		const response = await fetch(next, {
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!response.ok) throw new Error(`Spotify API error (${response.status})`)
		const page = await response.json()
		for (const item of page.items || []) {
			if (item?.id) ids.push(item.id)
		}
		next = page.next
	}

	return ids
}

async function fetchTracksByIds(token, ids) {
	// Dev Mode (Feb 2026+): batch GET /tracks?ids=… returns 403. Fetch one-by-one.
	const tracks = []
	const concurrency = 6
	for (let i = 0; i < ids.length; i += concurrency) {
		const chunk = ids.slice(i, i + concurrency)
		const batch = await Promise.all(
			chunk.map((id) => spotifyGet(token, `/tracks/${id}`))
		)
		tracks.push(...batch)
	}
	return tracks
}

function buildPayload(album, tracks, options = {}) {
	const rows = tracks.map((track) => ({
		number: track.track_number,
		disc: track.disc_number,
		title: track.name,
		artists: (track.artists || []).map((a) => a.name).join(', '),
		isrc: track.external_ids?.isrc || '',
		id: track.id,
		durationMs: track.duration_ms || 0,
		spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
	}))

	return {
		album: album.name,
		artists: (album.artists || []).map((a) => a.name).join(', '),
		upc: album.external_ids?.upc || '',
		label: album.label || '',
		releaseDate: album.release_date || '',
		spotifyUrl: album.external_urls?.spotify || '',
		durationMs: rows.reduce((sum, track) => sum + track.durationMs, 0),
		tracks: rows,
		focusTrackId: options.focusTrackId || null,
	}
}

function render(payload) {
	const upc = payload.upc || '—'
	metaEl.innerHTML = `
		<div><em>‘${escapeHtml(payload.album)}’</em> by ${escapeHtml(payload.artists)}</div>
		<div>UPC: <strong>${escapeHtml(upc)}</strong></div>
		${payload.durationMs ? `<div>Length: ${escapeHtml(formatDuration(payload.durationMs))}</div>` : ''}
		${payload.label ? `<div>Label: ${escapeHtml(payload.label)}</div>` : ''}
		${payload.releaseDate ? `<div>Released on ${escapeHtml(payload.releaseDate)}</div>` : ''}
	`

	if (payload.focusTrackId && payload.spotifyUrl) {
		albumBtn.href = barcoderHref(payload.spotifyUrl)
		albumBtn.hidden = false
	} else {
		albumBtn.hidden = true
		albumBtn.removeAttribute('href')
	}

	const multiDisc = payload.tracks.some((t) => t.disc > 1)
	tracksBody.innerHTML = payload.tracks.map((track) => {
		const num = multiDisc ? `${track.disc}.${track.number}` : String(track.number)
		const highlight = payload.focusTrackId && track.id === payload.focusTrackId
			? ' data-focus="true"'
			: ''
		const infoHref = barcoderHref(track.spotifyUrl)
		return `
			<tr${highlight}>
				<td>${escapeHtml(num)}</td>
				<td>${escapeHtml(track.title)}</td>
				<td class=duration>${escapeHtml(formatDuration(track.durationMs))}</td>
				<td class=isrc>${escapeHtml(track.isrc || '—')}</td>
				<td class=links>
					<a href="${escapeHtml(infoHref)}">info</a>
					<a href="${escapeHtml(track.spotifyUrl)}" target=_blank rel=noopener>spotify</a>
				</td>
			</tr>
		`
	}).join('')

	resultsEl.hidden = false
}

function barcoderHref(spotifyUrl) {
	const next = new URL(location.href)
	next.searchParams.set(URL_PARAM, spotifyUrl)
	next.hash = ''
	return next.pathname + next.search
}

function formatDuration(ms) {
	const totalSec = Math.round((ms || 0) / 1000)
	const hours = Math.floor(totalSec / 3600)
	const minutes = Math.floor((totalSec % 3600) / 60)
	const seconds = totalSec % 60
	const pad = (n) => String(n).padStart(2, '0')
	if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
	return `${minutes}:${pad(seconds)}`
}

function formatCopyText(payload) {
	if (payload.focusTrackId) return formatTrackCopyText(payload)
	return formatAlbumCopyText(payload)
}

function formatTrackCopyText(payload) {
	const track = payload.tracks.find((t) => t.id === payload.focusTrackId)
		|| payload.tracks[0]
	const multiDisc = payload.tracks.some((t) => t.disc > 1)
		|| (track && track.disc > 1)
	const trackNo = track
		? (multiDisc ? `${track.disc}.${track.number}` : String(track.number))
		: ''

	const lines = [
		`Track: ${track?.title || ''}`,
		`Artist(s): ${track?.artists || payload.artists}`,
		`ISRC: ${track?.isrc || ''}`,
		`Length: ${formatDuration(track?.durationMs || 0)}`,
		'',
		`Album: ${payload.album}`,
		`Album artist(s): ${payload.artists}`,
		`UPC: ${payload.upc || ''}`,
		`Label: ${payload.label || ''}`,
		`Release: ${payload.releaseDate || ''}`,
		`Track #: ${trackNo}`,
		'',
		'More details: ' + location.href,
	]

	return lines.join('\n')
}

function formatAlbumCopyText(payload) {
	const lines = [
		`Album: ${payload.album}`,
		`Artist(s): ${payload.artists}`,
		`UPC: ${payload.upc || ''}`,
		`Length: ${formatDuration(payload.durationMs)}`,
		`Label: ${payload.label || ''}`,
		`Release: ${payload.releaseDate || ''}`,
		'',
	]

	const multiDisc = payload.tracks.some((t) => t.disc > 1)
	const rows = [
		['#', 'Title', 'Length', 'ISRC'],
		...payload.tracks.map((track) => [
			multiDisc ? `${track.disc}.${track.number}` : String(track.number),
			track.title,
			formatDuration(track.durationMs),
			track.isrc || '',
		]),
	]

	const widths = rows[0].map((_, col) =>
		Math.max(...rows.map((row) => String(row[col]).length))
	)

	const padCell = (text, width, align = 'left') => {
		const gap = Math.max(0, width - text.length)
		if (align === 'right') return ' '.repeat(gap) + text
		return text + ' '.repeat(gap)
	}

	for (const row of rows) {
		lines.push(
			row
				.map((cell, col) => {
					const text = String(cell)
					const align = col === 0 || col === 2 ? 'right' : 'left'
					return padCell(text, widths[col], align)
				})
				.join('  ')
		)
	}

	lines.push('', 'More details: ' + location.href)
	return lines.join('\n')
}

function setStatus(message, isError = false) {
	if (!message) {
		statusEl.hidden = true
		statusEl.textContent = ''
		statusEl.removeAttribute('data-error')
		return
	}
	statusEl.hidden = false
	statusEl.textContent = message
	statusEl.dataset.error = isError ? 'true' : 'false'
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}
