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
const spotifyKeysLink = document.getElementById('spotify-keys-link')
const spotifyKeysAction = document.getElementById('spotify-keys-action')
const spotifyKeysDialog = document.getElementById('spotify-keys-dialog')
const spotifyKeysForm = document.getElementById('spotify-keys-form')
const spotifyClientIdInput = document.getElementById('spotify-client-id')
const spotifyClientSecretInput = document.getElementById('spotify-client-secret')
const spotifyKeysClose = document.getElementById('spotify-keys-close')
const spotifyKeysHistory = document.getElementById('spotify-keys-history')
const spotifyKeysList = document.getElementById('spotify-keys-list')

const URL_PARAM = 'url'
const SPOTIFY_KEYS_STORAGE = 'barcoder.spotifyKeys'
const canNativeShare = typeof navigator.share === 'function'
const shareBtnLabel = canNativeShare ? 'Share' : 'Copy link'
shareBtn.textContent = shareBtnLabel

let spotifyToken = null
let tokenExpiry = 0
let lastPayload = null

refreshSpotifyUi()

spotifyKeysLink?.addEventListener('click', (event) => {
	event.preventDefault()
	openSpotifyKeysDialog()
})

spotifyKeysClose?.addEventListener('click', () => {
	spotifyKeysDialog.close()
})

spotifyKeysDialog?.addEventListener('close', syncScrollLock)
copyDialog?.addEventListener('close', syncScrollLock)

spotifyKeysForm?.addEventListener('submit', (event) => {
	event.preventDefault()
	const clientId = spotifyClientIdInput.value.trim()
	const clientSecret = spotifyClientSecretInput.value.trim()
	if (!clientId || !clientSecret) return
	setCurrentSpotifyKeys(clientId, clientSecret)
	spotifyToken = null
	tokenExpiry = 0
	spotifyClientIdInput.value = ''
	spotifyClientSecretInput.value = ''
	refreshSpotifyUi()
	renderSpotifyKeysList()
})

spotifyKeysList?.addEventListener('click', (event) => {
	const button = event.target.closest('[data-remove-id]')
	if (!button) return
	removeSpotifyKey(button.getAttribute('data-remove-id'))
	spotifyToken = null
	tokenExpiry = 0
	renderSpotifyKeysList()
	refreshSpotifyUi()
})

form.addEventListener('submit', async (event) => {
	event.preventDefault()
	const url = normalizeUrl(input.value.trim())
	if (!url) return
	input.value = url
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
	syncScrollLock()
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
	const store = loadSpotifyKeysStore()
	if (store.current?.clientId && store.current?.clientSecret) {
		return {
			clientId: store.current.clientId,
			clientSecret: store.current.clientSecret,
			source: 'local',
		}
	}
	const cfg = window.BARCODER || {}
	return {
		clientId: cfg.clientId || '',
		clientSecret: cfg.clientSecret || '',
		source: 'config',
	}
}

function hasSpotifyCredentials() {
	const { clientId, clientSecret } = credentials()
	return Boolean(clientId && clientSecret)
}

function refreshSpotifyUi() {
	const hasCreds = hasSpotifyCredentials()
	if (spotifyKeysAction) {
		spotifyKeysAction.textContent = hasCreds ? 'edit/view' : 'add'
	}
	input.placeholder = hasCreds
		? 'Deezer or Spotify album/track URL'
		: 'Deezer album/track URL'
}

function loadSpotifyKeysStore() {
	try {
		const raw = localStorage.getItem(SPOTIFY_KEYS_STORAGE)
		if (!raw) return { current: null, previous: [] }
		const data = JSON.parse(raw)
		const current = normalizeSpotifyKeyEntry(data.current)
		const previous = Array.isArray(data.previous)
			? data.previous.map(normalizeSpotifyKeyEntry).filter(Boolean)
			: []
		return { current, previous }
	} catch {
		return { current: null, previous: [] }
	}
}

function saveSpotifyKeysStore(store) {
	localStorage.setItem(SPOTIFY_KEYS_STORAGE, JSON.stringify({
		current: store.current,
		previous: store.previous || [],
	}))
}

function normalizeSpotifyKeyEntry(entry) {
	if (!entry || typeof entry !== 'object') return null
	const clientId = String(entry.clientId || '').trim()
	const clientSecret = String(entry.clientSecret || '').trim()
	if (!clientId) return null
	return {
		clientId,
		clientSecret,
		requests: Math.max(0, Number(entry.requests) || 0),
	}
}

function setCurrentSpotifyKeys(clientId, clientSecret) {
	const id = clientId.trim()
	const secret = clientSecret.trim()
	const store = loadSpotifyKeysStore()
	const previous = [...(store.previous || [])]

	if (store.current?.clientId && store.current.clientId !== id) {
		const existingIndex = previous.findIndex((item) => item.clientId === store.current.clientId)
		const archived = {
			clientId: store.current.clientId,
			clientSecret: store.current.clientSecret,
			requests: store.current.requests || 0,
		}
		if (existingIndex >= 0) previous.splice(existingIndex, 1)
		previous.unshift(archived)
	}

	const fromPrevious = previous.find((item) => item.clientId === id)
	const nextPrevious = previous.filter((item) => item.clientId !== id)
	const keepRequests = store.current?.clientId === id
		? (store.current.requests || 0)
		: (fromPrevious?.requests || 0)

	saveSpotifyKeysStore({
		current: { clientId: id, clientSecret: secret, requests: keepRequests },
		previous: nextPrevious,
	})
}

function removeSpotifyKey(clientId) {
	const store = loadSpotifyKeysStore()
	if (store.current?.clientId === clientId) {
		saveSpotifyKeysStore({
			current: null,
			previous: store.previous || [],
		})
		return
	}
	saveSpotifyKeysStore({
		current: store.current,
		previous: (store.previous || []).filter((item) => item.clientId !== clientId),
	})
}

function recordSpotifyRequest() {
	const store = loadSpotifyKeysStore()
	if (!store.current?.clientId) return
	store.current.requests = (store.current.requests || 0) + 1
	saveSpotifyKeysStore(store)
}

function openSpotifyKeysDialog() {
	spotifyClientIdInput.value = ''
	spotifyClientSecretInput.value = ''
	spotifyClientSecretInput.placeholder = ''
	renderSpotifyKeysList()
	spotifyKeysDialog.showModal()
	syncScrollLock()
	spotifyClientIdInput.focus()
}

let scrollLockY = 0

function syncScrollLock() {
	const open = Boolean(document.querySelector('dialog[open]'))
	if (open) {
		if (document.body.dataset.scrollLocked === '1') return
		scrollLockY = window.scrollY
		document.body.dataset.scrollLocked = '1'
		document.body.style.position = 'fixed'
		document.body.style.top = `-${scrollLockY}px`
		document.body.style.left = '0'
		document.body.style.right = '0'
		document.body.style.overflow = 'hidden'
		return
	}
	if (document.body.dataset.scrollLocked !== '1') return
	delete document.body.dataset.scrollLocked
	document.body.style.position = ''
	document.body.style.top = ''
	document.body.style.left = ''
	document.body.style.right = ''
	document.body.style.overflow = ''
	window.scrollTo(0, scrollLockY)
}

function renderSpotifyKeysList() {
	const store = loadSpotifyKeysStore()
	const rows = []
	if (store.current) {
		rows.push({ ...store.current, current: true })
	}
	for (const item of store.previous || []) {
		rows.push({ ...item, current: false })
	}

	spotifyKeysHistory.hidden = rows.length === 0
	spotifyKeysList.innerHTML = rows.map((item) => {
		const requests = item.requests || 0
		const label = requests === 1 ? '1 request' : `${requests} requests`
		const remove = `<button type=button data-remove-id="${escapeAttr(item.clientId)}">Remove</button>`
		const badge = item.current ? ' <span class=key-badge>current</span>' : ''
		return `
			<li>
				<div class=key-meta>
					<div class=key-id>${escapeHtml(item.clientId)}${badge}</div>
					<div class=key-stats>${escapeHtml(label)}</div>
				</div>
				${remove}
			</li>
		`
	}).join('')
}

function escapeAttr(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}


async function lookup(url) {
	setStatus('Looking up…')
	resultsEl.hidden = true
	lastPayload = null
	albumBtn.hidden = true
	shareBtn.disabled = true
	copyBtn.disabled = true

	try {
		const parsed = parseMusicUrl(url)
		if (!parsed) {
			throw new Error('Paste a Spotify or Deezer album/track URL')
		}

		const payload = parsed.provider === 'deezer'
			? await lookupDeezer(parsed)
			: await lookupSpotify(parsed)

		lastPayload = payload
		render(payload)
		setStatus('')
		shareBtn.disabled = false
		copyBtn.disabled = false
	} catch (error) {
		setStatus(error.message || 'Lookup failed', true)
	}
}

async function lookupSpotify(parsed) {
	const { clientId, clientSecret } = credentials()
	if (!clientId || !clientSecret) {
		throw new Error('Add Spotify API keys (click “add” above) or use a Deezer link')
	}
	const token = await getToken(clientId, clientSecret)
	return parsed.type === 'album'
		? await fetchSpotifyAlbumPayload(token, parsed.id)
		: await fetchSpotifyTrackPayload(token, parsed.id)
}

async function lookupDeezer(parsed) {
	return parsed.type === 'album'
		? await fetchDeezerAlbumPayload(parsed.id)
		: await fetchDeezerTrackPayload(parsed.id)
}

function parseMusicUrl(raw) {
	const value = normalizeUrl(raw.trim())

	const spotifyUri = value.match(/^spotify:(album|track):([A-Za-z0-9]+)$/i)
	if (spotifyUri) {
		return { provider: 'spotify', type: spotifyUri[1].toLowerCase(), id: spotifyUri[2] }
	}

	try {
		const u = new URL(value)
		const host = (u.hostname || '').toLowerCase()

		if (host.includes('spotify.com')) {
			const parts = u.pathname.split('/').filter(Boolean)
			const typeIndex = parts.findIndex((p) => p === 'album' || p === 'track')
			if (typeIndex === -1 || !parts[typeIndex + 1]) return null
			return {
				provider: 'spotify',
				type: parts[typeIndex],
				id: parts[typeIndex + 1].split('?')[0],
			}
		}

		if (host.includes('deezer.com')) {
			const parts = u.pathname.split('/').filter(Boolean)
			const typeIndex = parts.findIndex((p) => p === 'album' || p === 'track')
			if (typeIndex === -1 || !parts[typeIndex + 1]) return null
			return {
				provider: 'deezer',
				type: parts[typeIndex],
				id: parts[typeIndex + 1].split('?')[0],
			}
		}
	} catch {
		return null
	}

	return null
}

function normalizeUrl(raw) {
	const value = String(raw || '').trim()
	if (!value) return value
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
		if (value.toLowerCase().startsWith('http://')) {
			return 'https://' + value.slice(7)
		}
		return value
	}
	return 'https://' + value.replace(/^\/+/, '')
}

async function getToken(clientId, clientSecret) {
	if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken

	recordSpotifyRequest()
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
	recordSpotifyRequest()
	const response = await fetch(`https://api.spotify.com/v1${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (!response.ok) {
		throw new Error(`Spotify API error (${response.status})`)
	}
	return response.json()
}

async function fetchSpotifyAlbumPayload(token, albumId) {
	const album = await spotifyGet(token, `/albums/${albumId}`)
	const trackIds = await collectSpotifyAlbumTrackIds(token, album)
	const tracks = await fetchSpotifyTracksByIds(token, trackIds)
	return buildSpotifyPayload(album, tracks)
}

async function fetchSpotifyTrackPayload(token, trackId) {
	const track = await spotifyGet(token, `/tracks/${trackId}`)
	const album = await spotifyGet(token, `/albums/${track.album.id}`)
	return buildSpotifyPayload(album, [track], { focusTrackId: track.id })
}

async function collectSpotifyAlbumTrackIds(token, album) {
	const ids = []
	let next = album.tracks?.next || null

	for (const item of album.tracks?.items || []) {
		if (item?.id) ids.push(item.id)
	}

	while (next) {
		recordSpotifyRequest()
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

async function fetchSpotifyTracksByIds(token, ids) {
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

function buildSpotifyPayload(album, tracks, options = {}) {
	const rows = tracks.map((track) => ({
		number: track.track_number,
		disc: track.disc_number,
		title: track.name,
		artists: (track.artists || []).map((a) => a.name).join(', '),
		isrc: track.external_ids?.isrc || '',
		id: track.id,
		durationMs: track.duration_ms || 0,
		url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
	}))

	return {
		provider: 'spotify',
		album: album.name,
		artists: (album.artists || []).map((a) => a.name).join(', '),
		upc: album.external_ids?.upc || '',
		label: album.label || '',
		releaseDate: album.release_date || '',
		sourceUrl: album.external_urls?.spotify || '',
		durationMs: rows.reduce((sum, track) => sum + track.durationMs, 0),
		tracks: rows,
		focusTrackId: options.focusTrackId || null,
	}
}

function deezerJsonp(pathOrUrl) {
	return new Promise((resolve, reject) => {
		const callback = `dzcb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
		const script = document.createElement('script')
		let settled = false

		const cleanup = () => {
			clearTimeout(timer)
			try { delete window[callback] } catch {}
			script.remove()
		}

		const finish = (fn, value) => {
			if (settled) return
			settled = true
			cleanup()
			fn(value)
		}

		const timer = setTimeout(() => {
			finish(reject, new Error('Deezer request timed out'))
		}, 15000)

		window[callback] = (data) => {
			if (data?.error) {
				finish(reject, new Error(data.error.message || 'Deezer API error'))
				return
			}
			finish(resolve, data)
		}

		script.onerror = () => finish(reject, new Error('Deezer request failed'))

		const url = new URL(
			/^https?:/i.test(pathOrUrl)
				? pathOrUrl
				: `https://api.deezer.com${pathOrUrl}`
		)
		url.searchParams.set('output', 'jsonp')
		url.searchParams.set('callback', callback)
		script.src = url.toString()
		document.head.appendChild(script)
	})
}

async function fetchDeezerAlbumPayload(albumId) {
	const album = await deezerJsonp(`/album/${albumId}`)
	if (!album?.id) throw new Error('Deezer album not found')
	const tracks = await collectDeezerAlbumTracks(albumId)
	return buildDeezerPayload(album, tracks)
}

async function fetchDeezerTrackPayload(trackId) {
	const track = await deezerJsonp(`/track/${trackId}`)
	if (!track?.id) throw new Error('Deezer track not found')
	const albumId = track.album?.id
	if (!albumId) throw new Error('Deezer track has no album')
	const album = await deezerJsonp(`/album/${albumId}`)
	return buildDeezerPayload(album, [track], { focusTrackId: String(track.id) })
}

async function collectDeezerAlbumTracks(albumId) {
	const tracks = []
	let next = `/album/${albumId}/tracks?limit=100`

	while (next) {
		const page = await deezerJsonp(next)
		for (const item of page.data || []) {
			if (item) tracks.push(item)
		}
		next = page.next || null
	}

	return tracks
}

function buildDeezerPayload(album, tracks, options = {}) {
	const albumArtists = deezerArtistNames(album)
	const rows = tracks.map((track) => ({
		number: track.track_position || 0,
		disc: track.disk_number || 1,
		title: track.title || '',
		artists: deezerTrackArtistNames(track, album, albumArtists),
		isrc: track.isrc || '',
		id: String(track.id),
		durationMs: (track.duration || 0) * 1000,
		url: track.link || `https://www.deezer.com/track/${track.id}`,
	}))

	return {
		provider: 'deezer',
		album: album.title || '',
		artists: albumArtists,
		upc: album.upc || '',
		label: album.label || '',
		releaseDate: album.release_date || '',
		sourceUrl: album.link || `https://www.deezer.com/album/${album.id}`,
		durationMs: rows.reduce((sum, track) => sum + track.durationMs, 0),
		tracks: rows,
		focusTrackId: options.focusTrackId || null,
	}
}

function deezerArtistNames(entity) {
	if (entity?.contributors?.length) {
		return entity.contributors.map((a) => a.name).filter(Boolean).join(', ')
	}
	return entity?.artist?.name || ''
}

function deezerTrackArtistNames(track, album, albumArtists) {
	if (track?.contributors?.length) return deezerArtistNames(track)
	// Album track lists omit contributors; reuse album artists when it's a multi-artist release.
	if (album?.contributors?.length > 1) return albumArtists
	return deezerArtistNames(track) || albumArtists
}

function render(payload) {
	const upc = payload.upc || '—'
	const providerLabel = payload.provider === 'deezer' ? 'deezer' : 'spotify'
	metaEl.innerHTML = `
		<div><em>‘${escapeHtml(payload.album)}’</em> by ${escapeHtml(payload.artists)}</div>
		<div>UPC: <strong>${escapeHtml(upc)}</strong></div>
		${payload.durationMs ? `<div>Length: ${escapeHtml(formatDuration(payload.durationMs))}</div>` : ''}
		${payload.label ? `<div>Label: ${escapeHtml(payload.label)}</div>` : ''}
		${payload.releaseDate ? `<div>Released on ${escapeHtml(payload.releaseDate)}</div>` : ''}
	`

	if (payload.focusTrackId && payload.sourceUrl) {
		albumBtn.href = barcoderHref(payload.sourceUrl)
		albumBtn.hidden = false
	} else {
		albumBtn.hidden = true
		albumBtn.removeAttribute('href')
	}

	const multiDisc = payload.tracks.some((t) => t.disc > 1)
	tracksBody.innerHTML = payload.tracks.map((track) => {
		const num = multiDisc ? `${track.disc}.${track.number}` : String(track.number)
		const highlight = payload.focusTrackId && String(track.id) === String(payload.focusTrackId)
			? ' data-focus="true"'
			: ''
		const infoHref = barcoderHref(track.url)
		return `
			<tr${highlight}>
				<td>${escapeHtml(num)}</td>
				<td>${escapeHtml(track.title)}</td>
				<td class=duration>${escapeHtml(formatDuration(track.durationMs))}</td>
				<td class=isrc>${escapeHtml(track.isrc || '—')}</td>
				<td class=links>
					<a href="${escapeHtml(infoHref)}">info</a>
					<a href="${escapeHtml(track.url)}" target=_blank rel=noopener>${providerLabel}</a>
				</td>
			</tr>
		`
	}).join('')

	resultsEl.hidden = false
}

function barcoderHref(musicUrl) {
	const next = new URL(location.href)
	next.searchParams.set(URL_PARAM, musicUrl)
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
