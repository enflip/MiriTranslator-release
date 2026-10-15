// ==UserScript==
// @name         MiriTranslator
// @namespace    https://github.com/enflip/MiriTranslator
// @version      0.2.0
// @author       MiriTranslator contributors
// @description  가벼운 브라우저 만화 번역기 — 로컬 지우기·조판 + 무료 API, 서버 불필요. Lightweight in-browser manga translator.
// @license      MIT
// @homepageURL  https://github.com/enflip/MiriTranslator-release
// @supportURL   https://github.com/enflip/MiriTranslator-release/issues
// @downloadURL  https://raw.githubusercontent.com/enflip/MiriTranslator-release/main/MiriTranslator.user.js
// @updateURL    https://raw.githubusercontent.com/enflip/MiriTranslator-release/main/MiriTranslator.meta.js
// @match        https://k-hentai.org/r/*
// @connect      k-hentai.org
// @connect      siam-cdn.net
// @connect      lensfrontend-pa.googleapis.com
// @connect      generativelanguage.googleapis.com
// @connect      clients5.google.com
// @connect      papago.naver.com
// @connect      www2.deepl.com
// @connect      translate.googleapis.com
// @connect      *
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function() {
	"use strict";
	var LANG_TAG = {
		japanese: "ja",
		korean: "ko",
		english: "en",
		chinese: "zh",
		spanish: "es",
		russian: "ru",
		french: "fr",
		german: "de",
		portuguese: "pt",
		italian: "it",
		thai: "th",
		vietnamese: "vi"
	};
	async function readGallery() {
		const w = globalThis.unsafeWindow ?? window;
		if (w.gallery?.files) return w.gallery;
		const viaEvent = await new Promise((resolve) => {
			const evName = `miri-gallery-${Math.random().toString(36).slice(2)}`;
			const timer = setTimeout(() => resolve(null), 1500);
			document.addEventListener(evName, (ev) => {
				clearTimeout(timer);
				try {
					resolve(JSON.parse(ev.detail));
				} catch {
					resolve(null);
				}
			}, { once: true });
			const s = document.createElement("script");
			s.textContent = `try{document.dispatchEvent(new CustomEvent(${JSON.stringify(evName)},{detail:JSON.stringify(typeof gallery!=="undefined"?gallery:null)}))}catch(e){document.dispatchEvent(new CustomEvent(${JSON.stringify(evName)},{detail:"null"}))}`;
			(document.head || document.documentElement).appendChild(s);
			s.remove();
		});
		if (viaEvent?.files) return viaEvent;
		for (const sc of Array.from(document.scripts)) {
			if (sc.src || !sc.textContent) continue;
			const m = /\bgallery\s*=\s*(\{)/.exec(sc.textContent);
			if (!m) continue;
			const start = m.index + m[0].length - 1;
			const json = extractBalanced(sc.textContent, start);
			if (!json) continue;
			try {
				const g = JSON.parse(json);
				if (g?.files) return g;
			} catch {}
		}
		return null;
	}
	function extractBalanced(src, start) {
		let depth = 0;
		let inStr = null;
		for (let i = start; i < src.length; i++) {
			const ch = src[i];
			if (inStr) {
				if (ch === "\\") i++;
				else if (ch === inStr) inStr = null;
				continue;
			}
			if (ch === "\"" || ch === "'") inStr = ch;
			else if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) return src.slice(start, i + 1);
			}
		}
		return null;
	}
	function currentPageFromHash(max) {
		const m = /^#(\d+)$/.exec(location.hash);
		const n = m ? parseInt(m[1], 10) : 1;
		return Math.min(Math.max(1, n || 1), Math.max(1, max));
	}
	var kHentaiAdapter = {
		id: "k-hentai",
		matches: (loc) => /(^|\.)k-hentai\.org$/.test(loc.hostname) && /^\/r\/\d+/.test(loc.pathname),
		async init() {
			const g = await readGallery();
			if (!g?.files?.length) return null;
			const pages = g.files.map((f, i) => {
				const rotated = f.image.orientation !== null && f.image.orientation >= 5 && f.image.extension !== "webp";
				return {
					index: i + 1,
					url: f.image.url,
					width: rotated ? f.image.height : f.image.width,
					height: rotated ? f.image.width : f.image.height
				};
			});
			const urlToIndex = new Map(pages.map((p) => [p.url, p.index]));
			const langs = (g.tags ?? []).filter((t) => t.tag?.[0] === "language").map((t) => t.tag[1]);
			const translated = langs.includes("translated");
			const langTag = langs.find((l) => LANG_TAG[l]);
			const sourceLang = langTag ? LANG_TAG[langTag] : null;
			const navCbs = new Set();
			let last = currentPageFromHash(pages.length);
			setInterval(() => {
				const now = currentPageFromHash(pages.length);
				if (now !== last) {
					last = now;
					navCbs.forEach((cb) => cb(now));
				}
			}, 250);
			window.addEventListener("hashchange", () => {
				const now = currentPageFromHash(pages.length);
				if (now !== last) {
					last = now;
					navCbs.forEach((cb) => cb(now));
				}
			});
			const imgCbs = new Set();
			const root = document.getElementById("khReader") ?? document.body;
			let scheduled = false;
			new MutationObserver(() => {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(() => {
					scheduled = false;
					imgCbs.forEach((cb) => cb());
				});
			}).observe(root, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["src", "data-src"]
			});
			return {
				chapterId: `k-hentai:${g.id}`,
				pages,
				sourceLang,
				alreadyTranslated: translated && sourceLang === "ko",
				referer: `https://k-hentai.org/r/${g.id}`,
				uiBottomOffset: 76,
				currentIndex: () => currentPageFromHash(pages.length),
				onNavigate(cb) {
					navCbs.add(cb);
					return () => navCbs.delete(cb);
				},
				imageElements() {
					const map = new Map();
					const scope = document.getElementById("khReader") ?? document.body;
					for (const img of Array.from(scope.querySelectorAll("img"))) {
						const orig = img.dataset.miriOrig || img.dataset.src || img.getAttribute("src") || "";
						let idx = urlToIndex.get(orig);
						if (idx === void 0 && /^\d+$/.test(img.id)) idx = parseInt(img.id, 10);
						if (idx !== void 0 && pages[idx - 1]) map.set(idx, img);
					}
					return map;
				},
				onImagesChanged(cb) {
					imgCbs.add(cb);
					return () => imgCbs.delete(cb);
				}
			};
		}
	};
	var DB = "miri-translator";
	var STORE = "pages";
	var MAX_ENTRIES = 400;
	var MAX_BYTES$1 = 262144e3;
	var dbp = null;
	function open() {
		if (dbp) return dbp;
		dbp = new Promise((resolve, reject) => {
			if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
			const req = indexedDB.open(DB, 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("createdAt", "createdAt");
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		return dbp;
	}
	function tx(mode, fn) {
		return open().then((db) => new Promise((resolve, reject) => {
			const t = db.transaction(STORE, mode);
			const st = t.objectStore(STORE);
			let result;
			const r = fn(st);
			if (r) r.onsuccess = () => result = r.result;
			t.oncomplete = () => resolve(result);
			t.onerror = () => reject(t.error);
			t.onabort = () => reject(t.error);
		}));
	}
	var pageCache = {
		async get(key) {
			try {
				return await tx("readonly", (st) => st.get(key));
			} catch {
				return;
			}
		},
		async put(entry) {
			try {
				await tx("readwrite", (st) => void st.put(entry));
				this.trim();
			} catch {}
		},
		async clear() {
			try {
				await tx("readwrite", (st) => void st.clear());
			} catch {}
		},
		async stats() {
			try {
				const all = await tx("readonly", (st) => st.getAll());
				return {
					count: all.length,
					bytes: all.reduce((s, e) => s + (e.bytes || 0), 0)
				};
			} catch {
				return {
					count: 0,
					bytes: 0
				};
			}
		},
		async trim() {
			const all = await tx("readonly", (st) => st.getAll());
			if (all.length <= MAX_ENTRIES && all.reduce((s, e) => s + (e.bytes || 0), 0) <= MAX_BYTES$1) return;
			all.sort((a, b) => a.createdAt - b.createdAt);
			let count = all.length;
			let bytes = all.reduce((s, e) => s + (e.bytes || 0), 0);
			const victims = [];
			for (const e of all) {
				if (count <= MAX_ENTRIES * .8 && bytes <= MAX_BYTES$1 * .8) break;
				victims.push(e.key);
				count--;
				bytes -= e.bytes || 0;
			}
			await tx("readwrite", (st) => {
				for (const k of victims) st.delete(k);
			});
		}
	};
	async function sha1Hex(bytes) {
		const subtle = globalThis.crypto?.subtle;
		if (subtle) {
			const d = await subtle.digest("SHA-1", bytes);
			return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
		}
		let h = 2166136261;
		for (let i = 0; i < bytes.length; i++) {
			h ^= bytes[i];
			h = Math.imul(h, 16777619) >>> 0;
		}
		return `fnv${h.toString(16)}-${bytes.length}`;
	}
	var g = globalThis;
	typeof g.GM_xmlhttpRequest === "function" || typeof g.GM !== "undefined" && g.GM?.xmlHttpRequest, typeof g.GM_getValue === "function" || typeof g.GM !== "undefined" && g.GM?.getValue, g.GM_registerMenuCommand;
	function gmRequest(req) {
		const xhr = g.GM_xmlhttpRequest ?? g.GM?.xmlHttpRequest;
		if (typeof xhr === "function") return new Promise((resolve, reject) => {
			let body = req.body;
			if (body instanceof Uint8Array) body = new Blob([body]);
			if (body instanceof ArrayBuffer) body = new Blob([body]);
			const handle = xhr({
				url: req.url,
				method: req.method ?? "GET",
				headers: req.headers,
				data: body,
				responseType: "arraybuffer",
				timeout: req.timeoutMs ?? 6e4,
				anonymous: req.anonymous ?? true,
				onload: (r) => resolve({
					status: r.status,
					statusText: r.statusText,
					headers: r.responseHeaders ?? "",
					body: r.response,
					finalUrl: r.finalUrl ?? req.url
				}),
				onerror: (e) => reject(new Error(`network error: ${e?.error ?? e?.statusText ?? "unknown"}`)),
				ontimeout: () => reject(new Error("timeout")),
				onabort: () => reject(new DOMException("aborted", "AbortError"))
			});
			req.signal?.addEventListener("abort", () => handle?.abort?.());
		});
		return fetch(req.url, {
			method: req.method ?? "GET",
			headers: req.headers,
			body: req.body,
			credentials: req.anonymous === false ? "include" : "omit",
			signal: req.signal
		}).then(async (r) => ({
			status: r.status,
			statusText: r.statusText,
			headers: [...r.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n"),
			body: await r.arrayBuffer(),
			finalUrl: r.url
		}));
	}
	async function gmGet(key, def) {
		if (typeof g.GM_getValue === "function") return g.GM_getValue(key, def);
		if (g.GM?.getValue) return await g.GM.getValue(key, def);
		try {
			const v = g.localStorage?.getItem(key);
			return v === null || v === void 0 ? def : JSON.parse(v);
		} catch {
			return def;
		}
	}
	async function gmSet(key, value) {
		if (typeof g.GM_setValue === "function") return g.GM_setValue(key, value);
		if (g.GM?.setValue) return g.GM.setValue(key, value);
		try {
			g.localStorage?.setItem(key, JSON.stringify(value));
		} catch {}
	}
	function gmMenu(label, fn) {
		if (typeof g.GM_registerMenuCommand === "function") g.GM_registerMenuCommand(label, fn);
	}
	function scriptVersion() {
		try {
			return g.GM_info?.script?.version ?? "dev";
		} catch {
			return "dev";
		}
	}
	var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	var luma$1 = (r, g, b) => .299 * r + .587 * g + .114 * b;
	function clipBox(b, W, H) {
		const x = clamp(Math.floor(b.x), 0, W - 1);
		const y = clamp(Math.floor(b.y), 0, H - 1);
		const x2 = clamp(Math.ceil(b.x + b.w), x + 1, W);
		const y2 = clamp(Math.ceil(b.y + b.h), y + 1, H);
		return {
			x,
			y,
			w: x2 - x,
			h: y2 - y
		};
	}
	function padBox(b, px, py = px) {
		return {
			x: b.x - px,
			y: b.y - py,
			w: b.w + 2 * px,
			h: b.h + 2 * py
		};
	}
	function median(arr) {
		if (!arr.length) return 0;
		const a = arr.slice().sort((p, q) => p - q);
		return a[a.length >> 1];
	}
	function sampleRing(img, inner, outer) {
		const rs = [];
		const gs = [];
		const bs = [];
		const { data, width } = img;
		const step = Math.max(1, Math.floor(Math.sqrt((outer.w * outer.h - inner.w * inner.h) / 4e3)));
		for (let y = outer.y; y < outer.y + outer.h; y += step) for (let x = outer.x; x < outer.x + outer.w; x += step) {
			if (x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h) continue;
			const i = (y * width + x) * 4;
			rs.push(data[i]);
			gs.push(data[i + 1]);
			bs.push(data[i + 2]);
		}
		if (!rs.length) return {
			bg: [
				255,
				255,
				255
			],
			spread: 0,
			count: 0
		};
		const bg = [
			median(rs),
			median(gs),
			median(bs)
		];
		const bl = luma$1(bg[0], bg[1], bg[2]);
		let dev = 0;
		for (let i = 0; i < rs.length; i++) dev += Math.abs(luma$1(rs[i], gs[i], bs[i]) - bl);
		return {
			bg,
			spread: dev / rs.length,
			count: rs.length
		};
	}
	function otsu(hist, total) {
		let sum = 0;
		for (let t = 0; t < 256; t++) sum += t * hist[t];
		let sumB = 0;
		let wB = 0;
		let max = -1;
		let thr = 127;
		for (let t = 0; t < 256; t++) {
			wB += hist[t];
			if (wB === 0) continue;
			const wF = total - wB;
			if (wF === 0) break;
			sumB += t * hist[t];
			const mB = sumB / wB;
			const mF = (sum - sumB) / wF;
			const between = wB * wF * (mB - mF) * (mB - mF);
			if (between > max) {
				max = between;
				thr = t;
			}
		}
		return thr;
	}
	function inkMask(img, rect, bg) {
		const { data, width } = img;
		const n = rect.w * rect.h;
		const L = new Float32Array(n);
		const hist = new Uint32Array(256);
		for (let yy = 0; yy < rect.h; yy++) for (let xx = 0; xx < rect.w; xx++) {
			const i = ((rect.y + yy) * width + rect.x + xx) * 4;
			const l = luma$1(data[i], data[i + 1], data[i + 2]);
			L[yy * rect.w + xx] = l;
			hist[l | 0]++;
		}
		const thr = otsu(hist, n);
		const bgL = luma$1(bg[0], bg[1], bg[2]);
		const inkDark = bgL >= thr;
		const mask = new Uint8Array(n);
		let count = 0;
		for (let i = 0; i < n; i++) {
			const l = L[i];
			if ((inkDark ? l < thr : l > thr) && Math.abs(l - bgL) > 24) {
				mask[i] = 1;
				count++;
			}
		}
		if (!count) return {
			mask,
			count
		};
		const label = new Int32Array(n).fill(-1);
		const stack = [];
		let removed = 0;
		for (let s = 0; s < n; s++) {
			if (!mask[s] || label[s] !== -1) continue;
			let minx = rect.w, maxx = -1, miny = rect.h, maxy = -1, touches = false, size = 0;
			const members = [];
			stack.push(s);
			label[s] = s;
			while (stack.length) {
				const p = stack.pop();
				members.push(p);
				size++;
				const px = p % rect.w;
				const py = p / rect.w | 0;
				if (px < minx) minx = px;
				if (px > maxx) maxx = px;
				if (py < miny) miny = py;
				if (py > maxy) maxy = py;
				if (px === 0 || py === 0 || px === rect.w - 1 || py === rect.h - 1) touches = true;
				const nb = [
					p - 1,
					p + 1,
					p - rect.w,
					p + rect.w
				];
				if (px === 0) nb[0] = -1;
				if (px === rect.w - 1) nb[1] = -1;
				for (const q of nb) if (q >= 0 && q < n && mask[q] && label[q] === -1) {
					label[q] = s;
					stack.push(q);
				}
			}
			const spanW = (maxx - minx + 1) / rect.w;
			const spanH = (maxy - miny + 1) / rect.h;
			const fill = size / ((maxx - minx + 1) * (maxy - miny + 1));
			if (touches && (spanW > .9 || spanH > .9) && fill < .35) {
				for (const m of members) mask[m] = 0;
				removed += size;
			}
		}
		return {
			mask,
			count: count - removed
		};
	}
	function dilate(mask, w, h, r) {
		let cur = mask;
		for (let k = 0; k < r; k++) {
			const next = new Uint8Array(cur.length);
			for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
				const i = y * w + x;
				if (cur[i] || x > 0 && cur[i - 1] || x < w - 1 && cur[i + 1] || y > 0 && cur[i - w] || y < h - 1 && cur[i + w]) next[i] = 1;
			}
			cur = next;
		}
		return cur;
	}
	function diffuseFill(img, rect, mask, bg, iterations) {
		const { data, width } = img;
		const w = rect.w;
		const h = rect.h;
		const n = w * h;
		const buf = new Float32Array(n * 3);
		const idxs = [];
		for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
			const p = yy * w + xx;
			const i = ((rect.y + yy) * width + rect.x + xx) * 4;
			if (mask[p]) {
				buf[p * 3] = bg[0];
				buf[p * 3 + 1] = bg[1];
				buf[p * 3 + 2] = bg[2];
				idxs.push(p);
			} else {
				buf[p * 3] = data[i];
				buf[p * 3 + 1] = data[i + 1];
				buf[p * 3 + 2] = data[i + 2];
			}
		}
		for (let it = 0; it < iterations; it++) for (const p of idxs) {
			const x = p % w;
			const y = p / w | 0;
			let r = 0, g = 0, b = 0, c = 0;
			if (x > 0) {
				r += buf[(p - 1) * 3];
				g += buf[(p - 1) * 3 + 1];
				b += buf[(p - 1) * 3 + 2];
				c++;
			}
			if (x < w - 1) {
				r += buf[(p + 1) * 3];
				g += buf[(p + 1) * 3 + 1];
				b += buf[(p + 1) * 3 + 2];
				c++;
			}
			if (y > 0) {
				r += buf[(p - w) * 3];
				g += buf[(p - w) * 3 + 1];
				b += buf[(p - w) * 3 + 2];
				c++;
			}
			if (y < h - 1) {
				r += buf[(p + w) * 3];
				g += buf[(p + w) * 3 + 1];
				b += buf[(p + w) * 3 + 2];
				c++;
			}
			if (c) {
				buf[p * 3] = r / c;
				buf[p * 3 + 1] = g / c;
				buf[p * 3 + 2] = b / c;
			}
		}
		for (const p of idxs) {
			const xx = p % w;
			const yy = p / w | 0;
			const i = ((rect.y + yy) * width + rect.x + xx) * 4;
			data[i] = buf[p * 3];
			data[i + 1] = buf[p * 3 + 1];
			data[i + 2] = buf[p * 3 + 2];
		}
	}
	function eraseRegion(img, region, opts) {
		const W = img.width;
		const H = img.height;
		const glyph = Math.max(6, Math.min(region.box.w, region.box.h));
		const pad = clamp(Math.round(glyph * .12), 2, 12);
		const rect = clipBox(padBox(region.box, pad), W, H);
		const ring = sampleRing(img, rect, clipBox(padBox(rect, clamp(Math.round(glyph * .1), 3, 10)), W, H));
		const flat = ring.spread < (opts.flatThreshold ?? 14);
		const info = {
			bg: ring.bg,
			flat,
			spread: ring.spread,
			inkPixels: 0,
			rect
		};
		region.bg = ring.bg;
		region.flat = flat;
		if (opts.mode === "overlay") return info;
		const { mask, count } = inkMask(img, rect, ring.bg);
		info.inkPixels = count;
		if (!count) return info;
		const grow = clamp(Math.round(glyph * .06), 1, 3);
		const m = dilate(mask, rect.w, rect.h, grow);
		if (flat || opts.mode === "flat-fill") {
			const { data } = img;
			for (let yy = 0; yy < rect.h; yy++) for (let xx = 0; xx < rect.w; xx++) {
				if (!m[yy * rect.w + xx]) continue;
				const i = ((rect.y + yy) * W + rect.x + xx) * 4;
				data[i] = ring.bg[0];
				data[i + 1] = ring.bg[1];
				data[i + 2] = ring.bg[2];
			}
		} else diffuseFill(img, rect, dilate(m, rect.w, rect.h, 1), ring.bg, clamp(Math.round(Math.max(rect.w, rect.h) / 2), 24, 90));
		return info;
	}
	function estimateLayoutRect(img, region, info) {
		const W = img.width;
		const H = img.height;
		const { data } = img;
		const bgL = luma$1(info.bg[0], info.bg[1], info.bg[2]);
		const tol = info.flat ? 40 : 24;
		const maxBad = .03;
		const isBg = (x, y) => {
			const i = (y * W + x) * 4;
			return Math.abs(luma$1(data[i], data[i + 1], data[i + 2]) - bgL) <= tol;
		};
		const colOk = (x, y0, y1) => {
			let bad = 0;
			const allowed = Math.max(1, Math.floor((y1 - y0) * maxBad));
			for (let y = y0; y < y1; y++) if (!isBg(x, y) && ++bad > allowed) return false;
			return true;
		};
		const rowOk = (y, x0, x1) => {
			let bad = 0;
			const allowed = Math.max(1, Math.floor((x1 - x0) * maxBad));
			for (let x = x0; x < x1; x++) if (!isBg(x, y) && ++bad > allowed) return false;
			return true;
		};
		const box = region.box;
		const start = clipBox(padBox(box, 1), W, H);
		const capX = Math.round(Math.max(box.w, box.h) * 1.6) + 8;
		const capY = Math.round(Math.max(box.h, box.w * .6) * 1) + 8;
		const grow = (s0, order) => {
			let { x, y, w, h } = s0;
			let l = 0, r = 0, t = 0, b = 0;
			const stepH = () => {
				let g = false;
				if (l < capX && x > 0 && colOk(x - 1, y, y + h)) {
					x--;
					w++;
					l++;
					g = true;
				}
				if (r < capX && x + w < W && colOk(x + w, y, y + h)) {
					w++;
					r++;
					g = true;
				}
				return g;
			};
			const stepV = () => {
				let g = false;
				if (t < capY && y > 0 && rowOk(y - 1, x, x + w)) {
					y--;
					h++;
					t++;
					g = true;
				}
				if (b < capY && y + h < H && rowOk(y + h, x, x + w)) {
					h++;
					b++;
					g = true;
				}
				return g;
			};
			if (order === "round") {
				let grew = true;
				while (grew) {
					const gh = stepH();
					const gv = stepV();
					grew = gh || gv;
				}
			} else {
				while (stepH());
				while (stepV());
			}
			return {
				x,
				y,
				w,
				h,
				l,
				r,
				t,
				b
			};
		};
		const first = grow(start, "round");
		if (!info.flat && first.l + first.r + first.t + first.b < 4) return box;
		const cands = [first, grow(start, "hfirst")];
		for (const f of [.75, .5]) {
			if (start.h * f < 24) break;
			const bh = Math.round(start.h * f);
			cands.push(grow({
				x: start.x,
				y: start.y + (start.h - bh >> 1),
				w: start.w,
				h: bh
			}, "hfirst"));
		}
		const trim = (g, keepBox) => {
			const m = clamp(Math.round(Math.min(g.w, g.h) * .08), 2, 14);
			let nx = g.x + Math.min(m, g.l);
			let ny = g.y + Math.min(m, g.t);
			let nx2 = g.x + g.w - Math.min(m, g.r);
			let ny2 = g.y + g.h - Math.min(m, g.b);
			if (keepBox) {
				nx = Math.min(box.x, nx);
				ny = Math.min(box.y, ny);
				nx2 = Math.max(box.x + box.w, nx2);
				ny2 = Math.max(box.y + box.h, ny2);
			}
			return clipBox({
				x: nx,
				y: ny,
				w: nx2 - nx,
				h: ny2 - ny
			}, W, H);
		};
		let best = trim(first, true);
		for (let i = 1; i < cands.length; i++) {
			const c = trim(cands[i], false);
			if (c.w * c.h > best.w * best.h * 1.05 && c.h >= Math.min(box.h, 2 * Math.max(10, Math.min(box.w, box.h)))) best = c;
		}
		return best;
	}
	function boxesIntersect(a, b) {
		return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
	}
	function cutRect(rect, obstacle, must) {
		const cands = [
			{
				x: rect.x,
				y: rect.y,
				w: rect.w,
				h: obstacle.y - rect.y
			},
			{
				x: rect.x,
				y: obstacle.y + obstacle.h,
				w: rect.w,
				h: rect.y + rect.h - (obstacle.y + obstacle.h)
			},
			{
				x: rect.x,
				y: rect.y,
				w: obstacle.x - rect.x,
				h: rect.h
			},
			{
				x: obstacle.x + obstacle.w,
				y: rect.y,
				w: rect.x + rect.w - (obstacle.x + obstacle.w),
				h: rect.h
			}
		];
		let best = null;
		for (const c of cands) {
			if (c.w <= 0 || c.h <= 0) continue;
			if (!(c.x <= must.x && c.y <= must.y && c.x + c.w >= must.x + must.w && c.y + c.h >= must.y + must.h)) continue;
			if (!best || c.w * c.h > best.w * best.h) best = c;
		}
		return best ?? { ...must };
	}
	function resolveLayoutOverlaps(regions) {
		const mustOf = (r) => {
			const l = r.layout;
			const x = Math.max(l.x, r.box.x);
			const y = Math.max(l.y, r.box.y);
			const x2 = Math.min(l.x + l.w, r.box.x + r.box.w);
			const y2 = Math.min(l.y + l.h, r.box.y + r.box.h);
			return x2 > x && y2 > y ? {
				x,
				y,
				w: x2 - x,
				h: y2 - y
			} : r.box;
		};
		for (let i = 0; i < regions.length; i++) {
			const a = regions[i];
			if (!a.layout) continue;
			for (let j = 0; j < regions.length; j++) {
				if (i === j) continue;
				const b = regions[j];
				if (boxesIntersect(a.layout, b.box)) a.layout = cutRect(a.layout, b.box, mustOf(a));
				if (j < i && b.layout && boxesIntersect(a.layout, b.layout)) a.layout = cutRect(a.layout, b.layout, mustOf(a));
			}
			if (a.layout.w * a.layout.h < a.box.w * a.box.h * .6) a.layout = { ...a.box };
		}
	}
	function bandIsClear(img, band, maxOutlierFrac = .035) {
		const b = clipBox(band, img.width, img.height);
		if (b.w < 1 || b.h < 1) return true;
		const n = b.w * b.h;
		const lum = new Uint8Array(n);
		let k = 0;
		for (let y = b.y; y < b.y + b.h; y++) {
			let o = (y * img.width + b.x) * 4;
			for (let x = 0; x < b.w; x++, o += 4) lum[k++] = img.data[o] * 77 + img.data[o + 1] * 151 + img.data[o + 2] * 28 >> 8;
		}
		const hist = new Uint32Array(256);
		for (let i = 0; i < n; i++) hist[lum[i]]++;
		let acc = 0;
		let med = 0;
		for (; med < 256; med++) {
			acc += hist[med];
			if (acc * 2 >= n) break;
		}
		let outliers = 0;
		for (let i = 0; i < n; i++) if (Math.abs(lum[i] - med) > 60) outliers++;
		return outliers <= Math.max(2, n * maxOutlierFrac);
	}
	function expand(b, dx, dy) {
		return {
			x: b.x - dx,
			y: b.y - dy,
			w: b.w + 2 * dx,
			h: b.h + 2 * dy
		};
	}
	function intersects(a, b) {
		return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
	}
	function union(a, b) {
		const x = Math.min(a.x, b.x);
		const y = Math.min(a.y, b.y);
		return {
			x,
			y,
			w: Math.max(a.x + a.w, b.x + b.w) - x,
			h: Math.max(a.y + a.h, b.y + b.h) - y
		};
	}
	var glyphSize = (l) => Math.min(l.box.w, l.box.h);
	var CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
	function relation(a, b) {
		const inset = Math.max(1, Math.round(.15 * Math.max(glyphSize(a), glyphSize(b))));
		if (a.vertical) {
			const left = a.box.x < b.box.x ? a.box : b.box;
			const gap = (left === a.box ? b.box : a.box).x - (left.x + left.w);
			const top = Math.max(a.box.y, b.box.y);
			const bot = Math.min(a.box.y + a.box.h, b.box.y + b.box.h);
			return {
				gap,
				overlap: bot - top,
				band: {
					x: left.x + left.w + inset,
					y: top,
					w: gap - 2 * inset,
					h: bot - top
				}
			};
		}
		const upper = a.box.y < b.box.y ? a.box : b.box;
		const gap = (upper === a.box ? b.box : a.box).y - (upper.y + upper.h);
		const l = Math.max(a.box.x, b.box.x);
		const r = Math.min(a.box.x + a.box.w, b.box.x + b.box.w);
		return {
			gap,
			overlap: r - l,
			band: {
				x: l,
				y: upper.y + upper.h + inset,
				w: r - l,
				h: gap - 2 * inset
			}
		};
	}
	function mergeLines(lines, opts = {}) {
		const n = lines.length;
		const parent = Array.from({ length: n }, (_, i) => i);
		const find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);
		const unite = (a, b) => parent[find(a)] = find(b);
		const useGroups = opts.useGroups !== false;
		const gapFactor = opts.gapFactor ?? 1;
		const maxRatio = opts.maxRatio ?? 1.6;
		const clear = (band) => !opts.gapClear || band.w < 3 || band.h < 3 || opts.gapClear(band);
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
			const a = lines[i];
			const b = lines[j];
			const sameGroup = useGroups && a.group !== void 0 && a.group === b.group;
			if (!!a.vertical !== !!b.vertical) {
				if (sameGroup) unite(i, j);
				continue;
			}
			const ga = glyphSize(a);
			const gb = glyphSize(b);
			const g = Math.max(ga, gb);
			const { gap, overlap, band } = relation(a, b);
			if (sameGroup) {
				if (overlap > 0 && gap > 2 && !clear(band)) continue;
				unite(i, j);
				continue;
			}
			if (Math.max(ga, gb) / Math.max(1, Math.min(ga, gb)) > maxRatio) continue;
			if (gap > g * gapFactor) continue;
			const minLen = a.vertical ? Math.min(a.box.h, b.box.h) : Math.min(a.box.w, b.box.w);
			if (overlap < Math.min(minLen * .3, g)) continue;
			if (gap > 2 && !clear(band)) continue;
			unite(i, j);
		}
		const groups = new Map();
		lines.forEach((l, i) => {
			const r = find(i);
			if (!groups.has(r)) groups.set(r, []);
			groups.get(r).push(l);
		});
		return Array.from(groups.values(), buildRegion);
	}
	function buildRegion(g) {
		const vertical = g.filter((l) => l.vertical).length * 2 >= g.length;
		g.sort((a, b) => vertical ? b.box.x + b.box.w / 2 - (a.box.x + a.box.w / 2) : a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));
		return {
			box: g.reduce((acc, l) => union(acc, l.box), g[0].box),
			lines: g,
			src: joinLines(g.map((l) => l.text.trim()).filter(Boolean)),
			dst: "",
			kind: "unknown",
			vertical
		};
	}
	function splitOverlapping(regions, gapClear) {
		const rs = regions.slice();
		const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
		const inter = (a, b) => {
			const x = Math.max(a.x, b.x);
			const y = Math.max(a.y, b.y);
			const r = Math.min(a.x + a.w, b.x + b.w);
			const btm = Math.min(a.y + a.h, b.y + b.h);
			return r > x && btm > y ? (r - x) * (btm - y) : 0;
		};
		for (let pass = 0; pass < 3; pass++) {
			let changed = false;
			outer: for (let i = 0; i < rs.length; i++) for (let j = 0; j < rs.length; j++) {
				if (i === j || rs[i].lines.length < 2) continue;
				if (inter(rs[i].box, rs[j].box) < .25 * Math.min(area(rs[i].box), area(rs[j].box))) continue;
				if (rs[i].lines.length < rs[j].lines.length) continue;
				const parts = mergeLines(rs[i].lines, {
					gapFactor: .6,
					useGroups: false,
					maxRatio: 2.2,
					gapClear
				});
				if (parts.length < 2) continue;
				rs.splice(i, 1, ...parts);
				changed = true;
				break outer;
			}
			if (!changed) break;
		}
		return rs;
	}
	function joinLines(parts) {
		let out = "";
		for (const p of parts) {
			if (!out) {
				out = p;
				continue;
			}
			const cjk = CJK.test(out.slice(-1)) || CJK.test(p[0]);
			if (/[A-Za-z]-$/.test(out) && /^[a-z]/i.test(p)) out = out.slice(0, -1) + p;
			else out += (cjk ? "" : " ") + p;
		}
		return cleanCjk(out);
	}
	var JA_ZH = /[\u3040-\u30ff\u3400-\u9fff\uff01-\uff5e、。]/;
	function cleanCjk(t) {
		if (!JA_ZH.test(t)) return t;
		let out = "";
		for (let i = 0; i < t.length; i++) {
			const ch = t[i];
			if (/\s/.test(ch)) {
				const prev = out[out.length - 1] ?? "";
				const next = t.slice(i + 1).trimStart()[0] ?? "";
				if (JA_ZH.test(prev) || JA_ZH.test(next) || /[!?！？…]/.test(next)) continue;
			}
			out += ch;
		}
		return out.replace(/[「」『』“”"]/g, "").replace(/([!?！？])[:：]+/g, "$1").replace(/\s+/g, " ").trim();
	}
	var KANA_ONLY = /^[\u3040-\u309f\u30a0-\u30ff\u30fc\s]+$/;
	function dropFurigana(lines) {
		if (lines.length < 2) return lines;
		const sizes = lines.map(glyphSize).sort((a, b) => a - b);
		const med = sizes[sizes.length >> 1];
		return lines.filter((l) => {
			if (!KANA_ONLY.test(l.text)) return true;
			const g = glyphSize(l);
			if (lines.length >= 3 && g < med * .62) return false;
			return !lines.some((o) => {
				if (o === l || glyphSize(o) < g * 1.6) return false;
				if (o.group !== void 0 && l.group !== void 0 && o.group !== l.group) return false;
				return intersects(l.vertical ? expand(l.box, g * 1.5, g * .5) : expand(l.box, g * .5, g * 1.5), o.box);
			});
		});
	}
	function sortReadingOrder(regions, rtl) {
		const rs = regions.slice();
		if (!rs.length) return rs;
		const bandH = Math.max(40, rs.reduce((s, r) => s + r.box.h, 0) / rs.length * 1.2);
		return rs.sort((a, b) => {
			const ba = Math.floor((a.box.y + a.box.h / 2) / bandH);
			const bb = Math.floor((b.box.y + b.box.h / 2) / bandH);
			if (ba !== bb) return ba - bb;
			const ca = a.box.x + a.box.w / 2;
			const cb = b.box.x + b.box.w / 2;
			return rtl ? cb - ca : ca - cb;
		});
	}
	function filterRegions(regions, pageW, pageH) {
		return regions.filter((r) => {
			if (!r.src) return false;
			const minSide = Math.min(pageW, pageH);
			if (r.box.w < minSide * .01 && r.box.h < minSide * .01) return false;
			if (/^[\d\s\-–—.·•|]+$/.test(r.src)) return false;
			if (r.src.replace(/[\s\p{P}]/gu, "").length === 0) return false;
			return true;
		});
	}
	function tagSfx(regions) {
		if (regions.length < 2) return;
		const glyphs = regions.map((r) => (r.vertical ? r.box.w : r.box.h) / Math.max(1, r.lines.length));
		const med = glyphs.slice().sort((a, b) => a - b)[glyphs.length >> 1];
		regions.forEach((r, i) => {
			if (r.kind !== "unknown") return;
			const chars = r.src.replace(/\s/g, "").length;
			const tilted = r.lines.some((l) => l.angle !== void 0 && !l.vertical && Math.abs(l.angle) > .08);
			if (glyphs[i] > med * 2.2 && chars <= 12 && r.lines.length <= 2 || tilted && chars <= 12) r.kind = "sfx";
		});
	}
	var browserRaster = {
		async decode(bytes, mime) {
			const blob = new Blob([bytes], { type: mime || sniffMime(bytes) });
			let bmp;
			try {
				bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
			} catch {
				bmp = await createImageBitmap(blob);
			}
			return {
				width: bmp.width,
				height: bmp.height,
				source: bmp,
				close: () => bmp.close()
			};
		},
		createCanvas(width, height) {
			if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
			const c = document.createElement("canvas");
			c.width = width;
			c.height = height;
			return c;
		},
		async encode(canvas, mime, quality = .9) {
			let blob;
			if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) blob = await canvas.convertToBlob({
				type: mime,
				quality
			});
			else blob = await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("toBlob failed")), mime, quality));
			return new Uint8Array(await blob.arrayBuffer());
		}
	};
	function sniffMime(b) {
		if (b[0] === 255 && b[1] === 216) return "image/jpeg";
		if (b[0] === 137 && b[1] === 80) return "image/png";
		if (b[0] === 82 && b[1] === 73 && b[8] === 87) return "image/webp";
		if (b[0] === 71 && b[1] === 73) return "image/gif";
		if (b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) return "image/avif";
		return "application/octet-stream";
	}
	async function prepareUpload(raster, img, maxSide, quality = .85, maxBytes = 38e5) {
		let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
		for (let attempt = 0; attempt < 4; attempt++) {
			const w = Math.max(1, Math.round(img.width * scale));
			const h = Math.max(1, Math.round(img.height * scale));
			const c = raster.createCanvas(w, h);
			const ctx = c.getContext("2d");
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, w, h);
			ctx.drawImage(img.source, 0, 0, w, h);
			const bytes = await raster.encode(c, "image/jpeg", quality);
			if (bytes.byteLength <= maxBytes || attempt === 3) return {
				bytes,
				mime: "image/jpeg",
				width: w,
				height: h,
				scale: img.width / w
			};
			scale *= .75;
		}
		throw new Error("unreachable");
	}
	var luma = (c) => .299 * c[0] + .587 * c[1] + .114 * c[2];
	var WORD_CHAR = /[\p{Script=Hangul}A-Za-z0-9À-ÿ]/u;
	function wrapText(ctx, text, maxWidth, mode = "words") {
		const lines = [];
		let forcedBreaks = 0;
		let wordSplits = 0;
		let doubleSplits = 0;
		const width = (s) => ctx.measureText(s.trimEnd()).width;
		for (const para of text.split(/\n/)) {
			const tokens = mode === "chars" ? tokenizeChars(para) : tokenize(para);
			let cur = [];
			let curWordSplit = false;
			const flush = () => {
				lines.push(cur.join("").trimEnd());
				cur = [];
			};
			const breakLine = (next) => {
				if (mode === "chars") {
					const last = cur[cur.length - 1];
					if (!(!/\s$/.test(last) && WORD_CHAR.test(last.slice(-1)) && WORD_CHAR.test(next.charAt(0)))) {
						flush();
						return;
					}
					let k = -1;
					for (let i = cur.length - 1; i > 0; i--) if (/\s$/.test(cur[i - 1])) {
						k = i;
						break;
					}
					if (k > 0 && (curWordSplit || width(cur.slice(0, k).join("")) >= .4 * width(cur.join("")))) {
						const rest = cur.slice(k);
						cur = cur.slice(0, k);
						flush();
						cur = rest;
						return;
					}
					wordSplits++;
					if (curWordSplit) doubleSplits++;
					curWordSplit = true;
				}
				flush();
			};
			for (const tok of tokens) {
				while (cur.length && width(cur.join("") + tok) > maxWidth) breakLine(tok);
				if (!cur.length && width(tok) > maxWidth && tok.trim().length > 1) {
					forcedBreaks++;
					let part = "";
					for (const ch of tok) if (part && ctx.measureText(part + ch).width > maxWidth) {
						lines.push(part.trimEnd());
						part = ch;
					} else part += ch;
					cur = [part];
				} else cur.push(tok);
				if (/\s$/.test(tok) || !WORD_CHAR.test(tok.trimEnd().slice(-1))) curWordSplit = false;
			}
			flush();
		}
		return {
			lines: lines.filter((l, i, a) => l.length || i > 0 && i < a.length - 1),
			forcedBreaks,
			wordSplits,
			doubleSplits
		};
	}
	var WORD = String.raw`[\p{Script=Hangul}A-Za-z0-9À-ÿ'’\-·]+`;
	var TRAIL = String.raw`[?!.,:;…~）」』\)\]"”'’]*`;
	var TOKEN_RE = new RegExp(`${WORD}${TRAIL}\\s*|[\\(\\[（「『"“]?[^\\s\\p{Script=Hangul}A-Za-z0-9À-ÿ?!.,:;…~）」』\\)\\]"”]${TRAIL}\\s*|\\S\\s*`, "gu");
	function tokenize(s) {
		const out = [];
		for (const m of s.matchAll(TOKEN_RE)) out.push(m[0]);
		return out;
	}
	var CHAR_RE = new RegExp(String.raw`[\(\[（「『"“]?[^\s][?!.,:;…~）」』\)\]"”'’]*\s*`, "gu");
	function tokenizeChars(s) {
		const out = [];
		for (const m of s.matchAll(CHAR_RE)) out.push(m[0]);
		return out;
	}
	function fitText(ctx, text, w, h, opts, maxPx = opts.maxFontPx, floorPx = 0) {
		const lh = opts.lineHeight ?? 1.18;
		const weight = opts.bold ? "700" : "500";
		const fits = (px, mode, lax = false) => {
			ctx.font = `${weight} ${px}px ${opts.font}`;
			const wr = wrapText(ctx, text, w, mode);
			if (mode === "words" && wr.forcedBreaks > 0) return null;
			if (mode === "chars" && !lax && wr.doubleSplits > 0) return null;
			if (wr.lines.length * px * lh > h) return null;
			for (const l of wr.lines) if (ctx.measureText(l).width > w) return null;
			return wr;
		};
		const hiPx = Math.max(opts.minFontPx, Math.min(maxPx, h));
		const search = (mode, lax = false) => {
			let lo = opts.minFontPx;
			let hi = hiPx;
			let best = null;
			while (lo <= hi) {
				const mid = lo + hi >> 1;
				const wr = fits(mid, mode, lax);
				if (wr) {
					best = {
						fontPx: mid,
						lines: wr.lines,
						lineHeight: lh,
						mode
					};
					lo = mid + 1;
				} else hi = mid - 1;
			}
			return best;
		};
		const byWords = search("words");
		let best = byWords;
		if (!byWords || byWords.fontPx < floorPx) {
			const top = search("chars", true);
			if (top) {
				const score = (px, wr) => px * Math.pow(.8, wr.wordSplits) * Math.pow(.6, wr.doubleSplits);
				let above = null;
				let any = null;
				const stop = Math.max(opts.minFontPx, byWords ? byWords.fontPx + 1 : opts.minFontPx);
				for (let px = top.fontPx; px >= stop; px--) {
					if (above && px < floorPx) break;
					const wr = fits(px, "chars", true);
					if (!wr) continue;
					const cand = {
						lay: {
							fontPx: px,
							lines: wr.lines,
							lineHeight: lh,
							mode: "chars"
						},
						score: score(px, wr)
					};
					if (px >= floorPx && (!above || cand.score > above.score)) above = cand;
					if (!any || cand.score > any.score) any = cand;
				}
				const pick = above ?? any;
				if (pick && (!byWords || pick === above || pick.score > byWords.fontPx)) best = pick.lay;
			}
		}
		if (!best) {
			ctx.font = `${weight} ${opts.minFontPx}px ${opts.font}`;
			best = {
				fontPx: opts.minFontPx,
				lines: wrapText(ctx, text, Math.max(w, opts.minFontPx * 2), "chars").lines,
				lineHeight: lh,
				mode: "chars"
			};
		}
		ctx.font = `${weight} ${best.fontPx}px ${opts.font}`;
		const n = best.lines.length;
		if (n > 1) {
			const splits0 = best.mode === "chars" ? wrapText(ctx, text, w, "chars").wordSplits : 0;
			for (let f = .95; f >= .55; f -= .05) {
				const wr = wrapText(ctx, text, w * f, best.mode);
				if (wr.lines.length !== n || best.mode === "words" && wr.forcedBreaks > 0 || wr.wordSplits > splits0 || wr.lines.some((l) => ctx.measureText(l).width > w)) break;
				best.lines = wr.lines;
			}
		}
		return best;
	}
	function enforceFloor(ctx, text, w, h, opts, layout, floorPx) {
		if (layout.fontPx >= floorPx) return layout;
		const lh = opts.lineHeight ?? 1.18;
		const weight = opts.bold ? "700" : "500";
		const maxOverflow = opts.maxOverflow ?? 1.6;
		ctx.font = `${weight} ${floorPx}px ${opts.font}`;
		let pick = null;
		let pickCost = Infinity;
		for (let f = 1; f <= maxOverflow + 1e-6; f += .15) {
			const wr = wrapText(ctx, text, w * f, "chars");
			const need = wr.lines.length * floorPx * lh;
			const widest = Math.max(...wr.lines.map((l) => ctx.measureText(l).width));
			const fx = Math.max(1, widest / w);
			const fy = need / h;
			const cost = Math.max(fx, fy) + .1 * (fx + fy) + .05 * wr.wordSplits;
			if (cost < pickCost) {
				pickCost = cost;
				pick = {
					fontPx: floorPx,
					lines: wr.lines,
					lineHeight: lh,
					mode: "chars",
					overflow: true,
					blockW: widest
				};
			}
		}
		return pick ?? layout;
	}
	function sourceGlyphPx(region) {
		const ls = region.lines ?? [];
		if (ls.length >= 2) {
			const sizes = ls.map((l) => region.vertical ? l.box.w : l.box.h).sort((a, b) => a - b);
			return sizes[sizes.length >> 1];
		}
		const chars = Math.max(1, region.src.replace(/\s/g, "").length);
		const area = region.box.w * region.box.h;
		return Math.sqrt(area / chars) * 1.05;
	}
	function drawRegion(ctx, region, opts) {
		const text = region.dst?.trim();
		if (!text) return null;
		const lay = region.layout ?? region.box;
		const padX = Math.max(2, lay.w * .04);
		const padY = Math.max(2, lay.h * .04);
		const w = Math.max(8, lay.w - padX * 2);
		const h = Math.max(8, lay.h - padY * 2);
		const cap = Math.max(opts.minFontPx + 2, Math.min(opts.maxFontPx, sourceGlyphPx(region) * (region.vertical ? 1.05 : 1.3)));
		const pageW = ctx.canvas?.width ?? 0;
		const pageH = ctx.canvas?.height ?? 0;
		const floorPx = Math.floor(Math.min(cap, Math.max(opts.minFontPx, pageW * (opts.floorRatio ?? .015))));
		const layout = enforceFloor(ctx, text, w, h, opts, fitText(ctx, text, w, h, opts, cap, floorPx), floorPx);
		const bg = region.bg ?? [
			255,
			255,
			255
		];
		const dark = luma(bg) < 128;
		const fill = dark ? "#ffffff" : "#111111";
		const stroke = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
		ctx.save();
		ctx.font = `${opts.bold ? "700" : "500"} ${layout.fontPx}px ${opts.font}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const total = layout.lines.length * layout.fontPx * layout.lineHeight;
		const widest = Math.max(...layout.lines.map((l) => ctx.measureText(l).width));
		let cx = lay.x + lay.w / 2;
		let cy = lay.y + lay.h / 2;
		if (layout.overflow && pageW && pageH) {
			const m = layout.fontPx * .5;
			cx = Math.min(Math.max(cx, widest / 2 + m), pageW - widest / 2 - m);
			cy = Math.min(Math.max(cy, total / 2 + m), pageH - total / 2 - m);
		}
		let y = cy - total / 2 + layout.fontPx * layout.lineHeight / 2;
		const overArt = region.flat === false && region.kind !== "bubble";
		const needStroke = !region.flat || region.kind === "sfx" || !!layout.overflow;
		if (overArt || layout.overflow) {
			ctx.fillStyle = overArt ? dark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.78)" : `rgba(${bg[0]},${bg[1]},${bg[2]},0.92)`;
			const bw = widest + layout.fontPx * .8;
			const bh = total + layout.fontPx * .4;
			roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, layout.fontPx * .5);
			ctx.fill();
		}
		for (const line of layout.lines) {
			if (needStroke) {
				ctx.lineJoin = "round";
				ctx.lineWidth = Math.max(2, layout.fontPx * .18);
				ctx.strokeStyle = dark ? "rgba(0,0,0,0.9)" : stroke;
				ctx.strokeText(line, cx, y);
			}
			ctx.fillStyle = fill;
			ctx.fillText(line, cx, y);
			y += layout.fontPx * layout.lineHeight;
		}
		ctx.restore();
		return layout;
	}
	function roundRect(ctx, x, y, w, h, r) {
		const rr = Math.min(r, w / 2, h / 2);
		ctx.beginPath();
		ctx.moveTo(x + rr, y);
		ctx.arcTo(x + w, y, x + w, y + h, rr);
		ctx.arcTo(x + w, y + h, x, y + h, rr);
		ctx.arcTo(x, y + h, x, y, rr);
		ctx.arcTo(x, y, x + w, y, rr);
		ctx.closePath();
	}
	var ProviderError = class extends Error {
		provider;
		status;
		terminal;
		constructor(message, provider, status, terminal = false) {
			super(message);
			this.provider = provider;
			this.status = status;
			this.terminal = terminal;
			this.name = "ProviderError";
		}
	};
	var SPECS = {
		lens: {
			minIntervalMs: 700,
			cooldownMs: 6e4
		},
		"google-unofficial": {
			minIntervalMs: 300,
			cooldownMs: 12e4
		},
		papago: {
			minIntervalMs: 500,
			cooldownMs: 12e4
		},
		deepl: {
			minIntervalMs: 1500,
			cooldownMs: 6e5
		},
		gemini: {
			minIntervalMs: 6500,
			cooldownMs: 65e3
		},
		default: {
			minIntervalMs: 500,
			cooldownMs: 6e4
		}
	};
	var Limiter = class {
		states = new Map();
		state(id) {
			let s = this.states.get(id);
			if (!s) {
				s = {
					next: 0,
					cooldownUntil: 0,
					chain: Promise.resolve()
				};
				this.states.set(id, s);
			}
			return s;
		}
		spec(id) {
			return SPECS[id] ?? SPECS[id.split(":")[0]] ?? SPECS.default;
		}
		isCoolingDown(id) {
			return this.state(id).cooldownUntil > Date.now();
		}
		cooldownRemaining(id) {
			return Math.max(0, this.state(id).cooldownUntil - Date.now());
		}
		acquire(id, signal) {
			const s = this.state(id);
			const spec = this.spec(id);
			const p = s.chain.then(async () => {
				const wait = Math.max(s.next, s.cooldownUntil) - Date.now();
				if (wait > 0) await sleep(wait, signal);
				s.next = Date.now() + spec.minIntervalMs;
			});
			s.chain = p.catch(() => void 0);
			return p;
		}
		reportTerminal(id, retryAfterMs) {
			const s = this.state(id);
			s.cooldownUntil = Date.now() + (retryAfterMs ?? this.spec(id).cooldownMs);
		}
	};
	function sleep(ms, signal) {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
			const t = setTimeout(resolve, ms);
			signal?.addEventListener("abort", () => {
				clearTimeout(t);
				reject(new DOMException("aborted", "AbortError"));
			});
		});
	}
	var limiter = new Limiter();
	var td$4 = new TextDecoder();
	var ENDPOINT$1 = "https://www2.deepl.com/jsonrpc";
	var MAX_JOBS = 50;
	var LANG$1 = {
		ko: "KO",
		en: "EN",
		ja: "JA",
		zh: "ZH",
		"zh-CN": "ZH",
		"zh-TW": "ZH",
		de: "DE",
		fr: "FR",
		es: "ES",
		it: "IT",
		pt: "PT",
		ru: "RU",
		id: "ID",
		auto: "auto"
	};
	function deeplSupports(sl, tl) {
		return !!LANG$1[tl] && tl !== "auto" && (sl === "auto" || !!LANG$1[sl]);
	}
	function timestamp(text) {
		let n = 0;
		for (const ch of text) if (ch === "i") n++;
		const now = Date.now();
		if (!n) return now;
		n++;
		return now - now % n + n;
	}
	async function request$1(texts, sl, tl, signal) {
		const id = (Math.floor(Math.random() * 99999) + 83e5) * 1e3;
		const jobs = texts.map((t, i) => ({
			kind: "default",
			preferred_num_beams: 1,
			raw_en_context_before: [],
			raw_en_context_after: [],
			sentences: [{
				prefix: "",
				text: t,
				id: i + 1
			}]
		}));
		const body = {
			jsonrpc: "2.0",
			method: "LMT_handle_jobs",
			id,
			params: {
				commonJobParams: {
					mode: "translate",
					formality: "undefined",
					transcribe_as: "romanize",
					advancedMode: false,
					textType: "plaintext",
					wasSpoken: false
				},
				lang: sl === "auto" ? { target_lang: LANG$1[tl] } : {
					source_lang_computed: LANG$1[sl],
					target_lang: LANG$1[tl]
				},
				jobs,
				priority: 1,
				timestamp: timestamp(texts.join(""))
			}
		};
		let json = JSON.stringify(body);
		json = json.replace("\"method\":\"", (id + 5) % 29 === 0 || (id + 3) % 13 === 0 ? "\"method\" : \"" : "\"method\": \"");
		const r = await gmRequest({
			url: ENDPOINT$1,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "*/*",
				Origin: "https://www.deepl.com",
				Referer: "https://www.deepl.com/"
			},
			body: json,
			signal,
			timeoutMs: 2e4
		});
		if (r.status === 429 || r.status === 403 || r.status === 401) throw new ProviderError(`deepl HTTP ${r.status}`, "deepl", r.status, true);
		if (r.status !== 200) throw new ProviderError(`deepl HTTP ${r.status}`, "deepl", r.status);
		const data = JSON.parse(td$4.decode(r.body));
		if (data?.error) throw new ProviderError(`deepl: ${data.error.message ?? "error"}`, "deepl", data.error.code);
		const tr = data?.result?.translations ?? [];
		if (tr.length !== texts.length) throw new ProviderError(`deepl returned ${tr.length} jobs for ${texts.length}`, "deepl");
		return tr.map((j) => (j?.beams?.[0]?.sentences ?? []).map((s) => s?.text ?? "").join(""));
	}
	async function deeplTranslate(texts, sl, tl, signal) {
		if (!texts.length) return [];
		if (!deeplSupports(sl, tl)) throw new ProviderError(`deepl: unsupported pair ${sl}→${tl}`, "deepl", 400, true);
		const clean = texts.map((t) => t.replace(/\s*\n\s*/g, " ").trim());
		const out = new Array(clean.length).fill("");
		const idx = clean.map((_, i) => i).filter((i) => clean[i]);
		for (let k = 0; k < idx.length; k += MAX_JOBS) {
			const part = idx.slice(k, k + MAX_JOBS);
			const res = await request$1(part.map((i) => clean[i]), sl, tl, signal);
			part.forEach((i, j) => out[i] = res[j].trim());
		}
		return out;
	}
	var td$3 = new TextDecoder();
	var LANG_NAMES = {
		ja: "Japanese",
		ko: "Korean",
		en: "English",
		zh: "Chinese",
		auto: "the source language (detect it)"
	};
	var name = (l) => LANG_NAMES[l] ?? l;
	function b64(bytes) {
		let s = "";
		const chunk = 32768;
		for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
		return btoa(s);
	}
	function thinkingConfig(model) {
		if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
		if (/gemini-3/.test(model)) return { thinkingLevel: "low" };
	}
	async function generate(model, key, body, signal) {
		const r = await gmRequest({
			url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
			timeoutMs: 9e4
		});
		const text = td$3.decode(r.body);
		if (r.status === 429) throw new ProviderError(`Gemini ${model} rate limited (429)`, `gemini:${model}`, 429, true);
		if (r.status === 400 && /API key/i.test(text)) throw new ProviderError("Gemini API key invalid", `gemini:${model}`, 400, true);
		if (r.status < 200 || r.status >= 300) throw new ProviderError(`Gemini ${model} HTTP ${r.status}: ${text.slice(0, 200)}`, `gemini:${model}`, r.status, r.status === 403);
		const json = JSON.parse(text);
		const part = json?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string");
		if (!part) throw new ProviderError(`Gemini ${model}: empty response (${json?.candidates?.[0]?.finishReason ?? "no candidates"})`, `gemini:${model}`);
		return JSON.parse(part.text);
	}
	function historyBlock(ctx) {
		const h = ctx.history.slice(-24);
		if (!h.length) return "";
		return `\nPrevious pages (source → translation), keep names, honorifics and tone consistent with these:\n${h.map((p) => `- ${p.src} → ${p.dst}`).join("\n")}\n`;
	}
	function glossaryBlock(ctx) {
		const g = Object.entries(ctx.glossary);
		if (!g.length) return "";
		return `\nGlossary (always use these):\n${g.map(([k, v]) => `- ${k} → ${v}`).join("\n")}\n`;
	}
	var ONESHOT_SCHEMA = {
		type: "ARRAY",
		items: {
			type: "OBJECT",
			properties: {
				box_2d: {
					type: "ARRAY",
					items: { type: "INTEGER" },
					description: "[ymin, xmin, ymax, xmax] normalised to 0-1000"
				},
				src: { type: "STRING" },
				dst: { type: "STRING" },
				kind: {
					type: "STRING",
					enum: [
						"bubble",
						"caption",
						"sfx"
					]
				},
				vertical: { type: "BOOLEAN" }
			},
			required: [
				"box_2d",
				"src",
				"dst",
				"kind"
			],
			propertyOrdering: [
				"box_2d",
				"kind",
				"vertical",
				"src",
				"dst"
			]
		}
	};
	async function geminiOneshot(img, ctx, opts) {
		const prompt = `You are a manga OCR + translation engine. Find EVERY text block in this comic page written in ${name(ctx.sourceLang)}: speech bubbles, thought bubbles, captions/narration boxes` + (opts.includeSfx ? ", and sound effects" : ". Ignore sound effects drawn as art (onomatopoeia) and ignore watermarks/page numbers") + `.\nFor each block return box_2d as [ymin, xmin, ymax, xmax] normalised to 0-1000 covering the whole text tightly, kind, vertical (true when the original text runs top-to-bottom), src (the original text, lines joined with a space) and dst (a natural ${name(ctx.targetLang)} translation that fits a speech bubble: concise, colloquial, matching the speaker's tone).\nOrder blocks in reading order (${ctx.sourceLang === "ja" ? "right-to-left, top-to-bottom" : "left-to-right, top-to-bottom"}). Return an empty array if there is no text.` + glossaryBlock(ctx) + historyBlock(ctx);
		const body = {
			contents: [{
				role: "user",
				parts: [{ inlineData: {
					mimeType: img.mime,
					data: b64(img.bytes)
				} }, { text: prompt }]
			}],
			generationConfig: {
				temperature: .2,
				responseMimeType: "application/json",
				responseSchema: ONESHOT_SCHEMA,
				...thinkingConfig(opts.model) ? { thinkingConfig: thinkingConfig(opts.model) } : {}
			},
			safetySettings: [
				"HARM_CATEGORY_HARASSMENT",
				"HARM_CATEGORY_HATE_SPEECH",
				"HARM_CATEGORY_SEXUALLY_EXPLICIT",
				"HARM_CATEGORY_DANGEROUS_CONTENT"
			].map((c) => ({
				category: c,
				threshold: "BLOCK_NONE"
			}))
		};
		const items = await generate(opts.model, opts.key, body, opts.signal);
		if (!Array.isArray(items)) throw new ProviderError("Gemini oneshot: response is not an array", `gemini:${opts.model}`);
		const regions = [];
		for (const it of items) {
			const b = it?.box_2d;
			if (!Array.isArray(b) || b.length !== 4 || typeof it.src !== "string") continue;
			const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(1e3, Math.max(0, Number(v) || 0)));
			const W = img.width * img.scale;
			const H = img.height * img.scale;
			const box = {
				x: Math.round(xmin / 1e3 * W),
				y: Math.round(ymin / 1e3 * H),
				w: Math.max(2, Math.round((xmax - xmin) / 1e3 * W)),
				h: Math.max(2, Math.round((ymax - ymin) / 1e3 * H))
			};
			const kind = it.kind === "sfx" || it.kind === "caption" || it.kind === "bubble" ? it.kind : "unknown";
			if (kind === "sfx" && !opts.includeSfx) continue;
			regions.push({
				box,
				lines: [{
					box,
					text: it.src
				}],
				src: it.src.trim(),
				dst: String(it.dst ?? "").trim(),
				kind,
				vertical: !!it.vertical
			});
		}
		return regions;
	}
	async function geminiTranslate(texts, ctx, opts) {
		if (!texts.length) return [];
		const body = {
			contents: [{
				role: "user",
				parts: [{ text: `Translate the following manga speech-bubble texts from ${name(ctx.sourceLang)} to ${name(ctx.targetLang)}. They come from one page in reading order; use the surrounding lines as context. Keep each translation concise and colloquial so it fits a bubble. Return a JSON array of exactly ${texts.length} strings in the same order (empty string if an item is not translatable text).` + glossaryBlock(ctx) + historyBlock(ctx) + `\nTexts:\n${JSON.stringify(texts)}` }]
			}],
			generationConfig: {
				temperature: .2,
				responseMimeType: "application/json",
				responseSchema: {
					type: "ARRAY",
					items: { type: "STRING" }
				},
				...thinkingConfig(opts.model) ? { thinkingConfig: thinkingConfig(opts.model) } : {}
			},
			safetySettings: [
				"HARM_CATEGORY_HARASSMENT",
				"HARM_CATEGORY_HATE_SPEECH",
				"HARM_CATEGORY_SEXUALLY_EXPLICIT",
				"HARM_CATEGORY_DANGEROUS_CONTENT"
			].map((c) => ({
				category: c,
				threshold: "BLOCK_NONE"
			}))
		};
		const out = await generate(opts.model, opts.key, body, opts.signal);
		if (!Array.isArray(out) || out.length !== texts.length) throw new ProviderError(`Gemini translate: expected ${texts.length} items, got ${Array.isArray(out) ? out.length : typeof out}`, `gemini:${opts.model}`);
		return out.map((s) => String(s ?? ""));
	}
	var td$2 = new TextDecoder();
	function langCode(l) {
		return {
			ja: "ja",
			ko: "ko",
			en: "en",
			zh: "zh-CN",
			"zh-TW": "zh-TW",
			auto: "auto"
		}[l] ?? l;
	}
	async function viaDictChromeEx(texts, sl, tl, signal) {
		const params = new URLSearchParams();
		params.set("client", "dict-chrome-ex");
		params.set("sl", langCode(sl));
		params.set("tl", langCode(tl));
		for (const t of texts) params.append("q", t);
		const r = await gmRequest({
			url: `https://clients5.google.com/translate_a/t?${params.toString()}`,
			method: "GET",
			headers: { Accept: "application/json" },
			signal,
			timeoutMs: 2e4
		});
		if (r.status === 429 || r.status === 403) throw new ProviderError(`dict-chrome-ex HTTP ${r.status}`, "google-unofficial", r.status, true);
		if (r.status !== 200) throw new ProviderError(`dict-chrome-ex HTTP ${r.status}`, "google-unofficial", r.status);
		const data = JSON.parse(td$2.decode(r.body));
		const out = [];
		const arr = Array.isArray(data) ? data : [data];
		for (const item of arr) if (typeof item === "string") out.push(item);
		else if (Array.isArray(item)) out.push(typeof item[0] === "string" ? item[0] : String(item[0] ?? ""));
		else if (item && typeof item === "object" && Array.isArray(item.sentences)) out.push(item.sentences.map((s) => s.trans ?? "").join(""));
		else out.push("");
		if (out.length !== texts.length) throw new ProviderError(`dict-chrome-ex returned ${out.length} items for ${texts.length} inputs`, "google-unofficial");
		return out;
	}
	async function viaGtx(text, sl, tl, signal) {
		const r = await gmRequest({
			url: `https://translate.googleapis.com/translate_a/single?${new URLSearchParams({
				client: "gtx",
				sl: langCode(sl),
				tl: langCode(tl),
				dt: "t",
				q: text
			})}`,
			method: "GET",
			signal,
			timeoutMs: 2e4
		});
		if (r.status === 429 || r.status === 403) throw new ProviderError(`gtx HTTP ${r.status}`, "google-unofficial", r.status, true);
		if (r.status !== 200) throw new ProviderError(`gtx HTTP ${r.status}`, "google-unofficial", r.status);
		return (JSON.parse(td$2.decode(r.body))?.[0] ?? []).map((s) => s?.[0] ?? "").join("");
	}
	async function googleTranslate(texts, sl, tl, signal) {
		if (texts.length === 0) return [];
		const clean = texts.map((t) => t.replace(/\s*\n\s*/g, " ").trim());
		try {
			const out = new Array(clean.length).fill("");
			const idx = clean.map((_, i) => i).filter((i) => clean[i]);
			const CHUNK = 80;
			for (let k = 0; k < idx.length; k += CHUNK) {
				const part = idx.slice(k, k + CHUNK);
				const res = await viaDictChromeEx(part.map((i) => clean[i]), sl, tl, signal);
				part.forEach((i, j) => out[i] = res[j]);
			}
			return out;
		} catch (e) {
			if (e instanceof ProviderError && e.terminal) throw e;
			const out = [];
			for (const t of clean) out.push(t ? await viaGtx(t, sl, tl, signal) : "");
			return out;
		}
	}
	var te = new TextEncoder();
	var td$1 = new TextDecoder("utf-8", { fatal: false });
	function varint(n) {
		const out = [];
		let v = n >>> 0;
		if (n > 4294967295) {
			let big = BigInt(n);
			while (big > 127n) {
				out.push(Number(big & 127n) | 128);
				big >>= 7n;
			}
			out.push(Number(big));
			return Uint8Array.from(out);
		}
		while (v > 127) {
			out.push(v & 127 | 128);
			v >>>= 7;
		}
		out.push(v);
		return Uint8Array.from(out);
	}
	function concat(parts) {
		let len = 0;
		for (const p of parts) len += p.length;
		const out = new Uint8Array(len);
		let o = 0;
		for (const p of parts) {
			out.set(p, o);
			o += p.length;
		}
		return out;
	}
	function fInt(field, value) {
		return concat([varint(field << 3 | 0), varint(value)]);
	}
	function fBytes(field, value) {
		const bytes = typeof value === "string" ? te.encode(value) : value;
		return concat([
			varint(field << 3 | 2),
			varint(bytes.length),
			bytes
		]);
	}
	function* readFields(buf) {
		let pos = 0;
		const readVarint = () => {
			let result = 0;
			let shift = 0;
			for (;;) {
				if (pos >= buf.length) throw new Error("proto: truncated varint");
				const b = buf[pos++];
				if (shift < 28) result |= (b & 127) << shift;
				else result += (b & 127) * 2 ** shift;
				if ((b & 128) === 0) break;
				shift += 7;
				if (shift > 63) throw new Error("proto: varint too long");
			}
			return result >>> 0 === result ? result : result;
		};
		while (pos < buf.length) {
			const tag = readVarint();
			const field = tag >>> 3;
			const wire = tag & 7;
			if (wire === 0) yield {
				field,
				wire,
				value: readVarint()
			};
			else if (wire === 1) {
				if (pos + 8 > buf.length) throw new Error("proto: truncated fixed64");
				const v = new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(0, true);
				pos += 8;
				yield {
					field,
					wire,
					value: v
				};
			} else if (wire === 2) {
				const len = readVarint();
				if (pos + len > buf.length) throw new Error("proto: truncated bytes");
				yield {
					field,
					wire,
					value: buf.subarray(pos, pos + len)
				};
				pos += len;
			} else if (wire === 5) {
				if (pos + 4 > buf.length) throw new Error("proto: truncated fixed32");
				const v = new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(0, true);
				pos += 4;
				yield {
					field,
					wire,
					value: v
				};
			} else throw new Error(`proto: unsupported wire type ${wire}`);
		}
	}
	function firstValues(buf) {
		const map = {};
		for (const f of readFields(buf)) if (!(f.field in map)) map[f.field] = f.value;
		return map;
	}
	function utf8(b) {
		return b instanceof Uint8Array ? td$1.decode(b) : "";
	}
	var LENS_ENDPOINT = "https://lensfrontend-pa.googleapis.com/v1/crupload";
	var LENS_API_KEY = "AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY";
	var MAX_BYTES = 4e6;
	function buildLensRequest(image, width, height, locale = {
		language: "en",
		region: "US",
		timeZone: "America/New_York"
	}) {
		const uuid = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
		const analytics = new Uint8Array(16);
		const c = globalThis.crypto;
		if (c && typeof c.getRandomValues === "function") c.getRandomValues(analytics);
		else for (let i = 0; i < 16; i++) analytics[i] = Math.random() * 256 | 0;
		const requestId = concat([
			fInt(1, uuid),
			fInt(2, 1),
			fInt(3, 1),
			fBytes(4, analytics)
		]);
		const localeCtx = concat([
			fBytes(1, locale.language),
			fBytes(2, locale.region),
			fBytes(3, locale.timeZone)
		]);
		const filters = fBytes(1, fInt(1, 7));
		const clientContext = concat([
			fInt(1, 2),
			fInt(2, 4),
			fBytes(4, localeCtx),
			fBytes(17, filters)
		]);
		const requestContext = concat([fBytes(3, requestId), fBytes(4, clientContext)]);
		const imageData = concat([fBytes(1, fBytes(1, image)), fBytes(3, concat([fInt(1, width), fInt(2, height)]))]);
		return fBytes(1, concat([fBytes(1, requestContext), fBytes(3, imageData)]));
	}
	function parseBox(chunk) {
		try {
			const m = firstValues(chunk);
			const num = (v) => typeof v === "number" ? v : 0;
			return {
				cx: num(m[1]),
				cy: num(m[2]),
				w: num(m[3]),
				h: num(m[4]),
				rotation: num(m[5])
			};
		} catch {
			return null;
		}
	}
	function parseGeometry(chunk) {
		try {
			for (const f of readFields(chunk)) if (f.field === 1 && f.wire === 2) return parseBox(f.value);
		} catch {}
		return null;
	}
	function parseWord(chunk) {
		const w = {
			text: "",
			separator: "",
			box: null
		};
		for (const f of readFields(chunk)) {
			if (f.wire !== 2) continue;
			if (f.field === 2) w.text = utf8(f.value);
			else if (f.field === 3) w.separator = utf8(f.value);
			else if (f.field === 4) w.box = parseGeometry(f.value);
		}
		return w;
	}
	function parseLine(chunk) {
		const words = [];
		let box = null;
		for (const f of readFields(chunk)) {
			if (f.wire !== 2) continue;
			if (f.field === 1) {
				const w = parseWord(f.value);
				if (w.text) words.push(w);
			} else if (f.field === 2) box = parseGeometry(f.value) ?? box;
		}
		let text = "";
		words.forEach((w, i) => {
			text += w.text;
			if (w.separator) text += w.separator;
			else if (i < words.length - 1) text += " ";
		});
		return {
			text: text.replace(/\s+/g, " ").trim(),
			words,
			box
		};
	}
	function parseParagraph(chunk) {
		const p = {
			lines: [],
			box: null,
			writing: null,
			language: ""
		};
		for (const f of readFields(chunk)) if (f.field === 2 && f.wire === 2) {
			const l = parseLine(f.value);
			if (l.text) p.lines.push(l);
		} else if (f.field === 3 && f.wire === 2) p.box = parseGeometry(f.value) ?? p.box;
		else if (f.field === 4 && f.wire === 0) p.writing = f.value;
		else if (f.field === 5 && f.wire === 2) p.language = utf8(f.value);
		return p;
	}
	function parseText(chunk) {
		const paragraphs = [];
		let language = "";
		for (const f of readFields(chunk)) if (f.field === 1 && f.wire === 2) {
			for (const f2 of readFields(f.value)) if (f2.field === 1 && f2.wire === 2) paragraphs.push(parseParagraph(f2.value));
		} else if (f.field === 2 && f.wire === 2) language = utf8(f.value);
		if (!language && paragraphs.length) language = paragraphs[0].language;
		return {
			paragraphs,
			language
		};
	}
	function parseLensResponse(bytes) {
		const res = {
			language: "",
			paragraphs: [],
			error: null
		};
		for (const f of readFields(bytes)) {
			if (f.wire !== 2) continue;
			if (f.field === 1) try {
				res.error = firstValues(f.value);
			} catch {
				res.error = {};
			}
			else if (f.field === 2) {
				for (const f2 of readFields(f.value)) if (f2.field === 3 && f2.wire === 2) {
					const t = parseText(f2.value);
					if (t.paragraphs.length) res.paragraphs = t.paragraphs;
					if (t.language) res.language = t.language;
				}
			}
		}
		return res;
	}
	function normBoxToPixels(b, width, height, scale = 1) {
		const w = b.w * width;
		const h = b.h * height;
		const c = Math.abs(Math.cos(b.rotation));
		const s = Math.abs(Math.sin(b.rotation));
		const aw = w * c + h * s;
		const ah = w * s + h * c;
		return {
			x: Math.round((b.cx * width - aw / 2) * scale),
			y: Math.round((b.cy * height - ah / 2) * scale),
			w: Math.max(1, Math.round(aw * scale)),
			h: Math.max(1, Math.round(ah * scale))
		};
	}
	function cleanLensText(t) {
		return t.replace(/\s+([?!.,:;…）」』])/g, "$1").replace(/([（「『])\s+/g, "$1").trim();
	}
	function lensLines(res, img) {
		const out = [];
		res.paragraphs.forEach((p, gi) => {
			for (const l of p.lines) {
				const nb = l.box ?? p.box;
				if (!nb) continue;
				const rot = nb.rotation;
				const vertical = Math.abs(Math.abs(rot) - Math.PI / 2) < .5 || p.writing === 2;
				out.push({
					box: normBoxToPixels(nb, img.width, img.height, img.scale),
					text: cleanLensText(l.text),
					angle: rot,
					vertical,
					group: gi
				});
			}
		});
		return out;
	}
	async function lensOcr(img, opts = {}) {
		if (img.bytes.byteLength > MAX_BYTES) throw new ProviderError(`image too large for Lens (${img.bytes.byteLength} bytes)`, "lens");
		const body = buildLensRequest(img.bytes, img.width, img.height);
		const r = await gmRequest({
			url: LENS_ENDPOINT,
			method: "POST",
			headers: {
				"Content-Type": "application/x-protobuf",
				"X-Goog-Api-Key": LENS_API_KEY,
				Accept: "*/*"
			},
			body,
			signal: opts.signal,
			timeoutMs: 4e4
		});
		if (r.status === 429 || r.status === 403) throw new ProviderError(`Lens HTTP ${r.status}`, "lens", r.status, true);
		if (r.status < 200 || r.status >= 300) throw new ProviderError(`Lens HTTP ${r.status}`, "lens", r.status);
		const raw = parseLensResponse(new Uint8Array(r.body));
		return {
			lines: lensLines(raw, img),
			language: raw.language,
			raw
		};
	}
	var td = new TextDecoder();
	var ENDPOINT = "https://papago.naver.com/api/text/translation";
	var MAX_CHARS = 4500;
	var LANG = {
		ko: "ko",
		en: "en",
		ja: "ja",
		zh: "zh-CN",
		"zh-CN": "zh-CN",
		"zh-TW": "zh-TW",
		vi: "vi",
		id: "id",
		th: "th",
		de: "de",
		ru: "ru",
		es: "es",
		it: "it",
		fr: "fr",
		hi: "hi",
		pt: "pt",
		auto: "auto"
	};
	function papagoSupports(sl, tl) {
		return !!LANG[tl] && tl !== "auto" && (sl === "auto" || !!LANG[sl]);
	}
	async function request(text, sl, tl, opts) {
		const form = new URLSearchParams();
		form.set("source", LANG[sl] ?? "auto");
		form.set("target", LANG[tl]);
		form.set("text", text);
		form.set("dict", "false");
		form.set("useGlossary", "false");
		form.set("honorific", opts.honorific ? "true" : "false");
		const r = await gmRequest({
			url: ENDPOINT,
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
				Accept: "application/json",
				Origin: "https://papago.naver.com",
				Referer: "https://papago.naver.com/"
			},
			body: form.toString(),
			signal: opts.signal,
			timeoutMs: 2e4
		});
		if (r.status === 429 || r.status === 403) throw new ProviderError(`papago HTTP ${r.status}`, "papago", r.status, true);
		if (r.status !== 200) throw new ProviderError(`papago HTTP ${r.status}`, "papago", r.status);
		let data;
		try {
			data = JSON.parse(td.decode(r.body));
		} catch {
			throw new ProviderError("papago: non-JSON response", "papago");
		}
		if (typeof data?.translatedText !== "string") throw new ProviderError(`papago: ${data?.errorMessage ?? "no translatedText"}`, "papago");
		return data.translatedText;
	}
	async function papagoTranslate(texts, sl, tl, opts = {}) {
		if (!texts.length) return [];
		if (!papagoSupports(sl, tl)) throw new ProviderError(`papago: unsupported pair ${sl}→${tl}`, "papago", 400, true);
		const clean = texts.map((t) => t.replace(/\s*\n\s*/g, " ").trim());
		const out = new Array(clean.length).fill("");
		const run = async (idx) => {
			const nonEmpty = idx.filter((i) => clean[i]);
			if (!nonEmpty.length) return;
			const joined = nonEmpty.map((i) => clean[i]).join("\n");
			if (joined.length > MAX_CHARS && nonEmpty.length > 1) {
				const mid = nonEmpty.length >> 1;
				await run(nonEmpty.slice(0, mid));
				await run(nonEmpty.slice(mid));
				return;
			}
			const res = (await request(joined, sl, tl, opts)).split("\n");
			if (res.length === nonEmpty.length) {
				nonEmpty.forEach((i, k) => out[i] = res[k].trim());
				return;
			}
			if (nonEmpty.length === 1) {
				out[nonEmpty[0]] = res.join(" ").trim();
				return;
			}
			const mid = nonEmpty.length >> 1;
			await run(nonEmpty.slice(0, mid));
			await run(nonEmpty.slice(mid));
		};
		await run(clean.map((_, i) => i));
		return out;
	}
	function translateChain(s, sl, tl) {
		const jaKo = sl === "ja" && tl === "ko";
		const chain = s.stages.translate.filter((id) => {
			if (id === "gemini-text") return !!s.keys.gemini;
			if (id === "papago") return papagoSupports(sl, tl);
			if (id === "deepl") return deeplSupports(sl, tl);
			if (id === "google-unofficial") return !jaKo || s.stages.googleForJaKo;
			return false;
		});
		if (!chain.includes("google-unofficial") && s.stages.translate.includes("google-unofficial")) chain.push("google-unofficial");
		return chain;
	}
	function geminiModels(s) {
		return [s.gemini.model, ...s.gemini.fallbackModels.filter((m) => m !== s.gemini.model)];
	}
	async function runOneshot(img, ctx, s, signal, log) {
		if (s.stages.oneshot !== "gemini-oneshot") throw new ProviderError(`unknown oneshot provider ${s.stages.oneshot}`, "registry");
		if (!s.keys.gemini) throw new ProviderError("Gemini API key missing", "gemini", 401, true);
		let last;
		for (const model of geminiModels(s)) {
			const id = `gemini:${model}`;
			if (limiter.isCoolingDown(id)) {
				log(`skip ${id} (cooldown ${Math.round(limiter.cooldownRemaining(id) / 1e3)}s)`);
				continue;
			}
			try {
				await limiter.acquire("gemini", signal);
				return {
					regions: await geminiOneshot(img, ctx, {
						key: s.keys.gemini,
						model,
						signal,
						includeSfx: s.stages.sfx
					}),
					provider: id
				};
			} catch (e) {
				last = e;
				if (e instanceof ProviderError && e.terminal) {
					limiter.reportTerminal(id);
					log(`${id} terminal: ${e.message}`);
					if (e.status === 400 || e.status === 401) throw e;
					continue;
				}
				if (e?.name === "AbortError") throw e;
				log(`${id} failed: ${e.message}`);
			}
		}
		throw last instanceof Error ? last : new ProviderError("all Gemini models failed", "gemini");
	}
	async function runOcr(img, s, signal, log) {
		if (s.stages.ocr !== "lens") throw new ProviderError(`unknown OCR provider ${s.stages.ocr}`, "registry");
		await limiter.acquire("lens", signal);
		try {
			const r = await lensOcr(img, { signal });
			return {
				lines: r.lines,
				language: r.language,
				provider: "lens"
			};
		} catch (e) {
			if (e instanceof ProviderError && e.terminal) limiter.reportTerminal("lens");
			throw e;
		}
	}
	async function runTranslate(texts, ctx, s, signal, log) {
		if (!texts.length) return {
			dst: [],
			provider: "none"
		};
		const chain = translateChain(s, ctx.sourceLang, ctx.targetLang);
		let last;
		for (const id of chain) try {
			if (id === "gemini-text") for (const model of geminiModels(s)) {
				const mid = `gemini:${model}`;
				if (limiter.isCoolingDown(mid)) continue;
				try {
					await limiter.acquire("gemini", signal);
					return {
						dst: await geminiTranslate(texts, ctx, {
							key: s.keys.gemini,
							model,
							signal
						}),
						provider: mid
					};
				} catch (e) {
					last = e;
					if (e instanceof ProviderError && e.terminal) limiter.reportTerminal(mid);
					if (e?.name === "AbortError") throw e;
					log(`${mid} translate failed: ${e.message}`);
				}
			}
			else {
				if (limiter.isCoolingDown(id)) throw new ProviderError(`${id} cooling down`, id, 429, true);
				await limiter.acquire(id, signal);
				return {
					dst: id === "papago" ? await papagoTranslate(texts, ctx.sourceLang, ctx.targetLang, { signal }) : id === "deepl" ? await deeplTranslate(texts, ctx.sourceLang, ctx.targetLang, signal) : await googleTranslate(texts, ctx.sourceLang, ctx.targetLang, signal),
					provider: id
				};
			}
		} catch (e) {
			last = e;
			if (e instanceof ProviderError && e.terminal) limiter.reportTerminal(id);
			if (e?.name === "AbortError") throw e;
			log(`${id} failed: ${e.message}`);
		}
		throw last instanceof Error ? last : new ProviderError("all translators failed", "registry");
	}
	var LANG_FROM_LENS = {
		ja: "ja",
		ko: "ko",
		en: "en",
		zh: "zh",
		"zh-Hans": "zh",
		"zh-Hant": "zh"
	};
	async function translatePage(input) {
		const { bytes, settings: s, raster, signal } = input;
		const log = input.log ?? (() => void 0);
		const t = {};
		const mark = (k, from) => t[k] = Math.round(performance.now() - from);
		let t0 = performance.now();
		const img = await raster.decode(bytes);
		mark("decode", t0);
		t0 = performance.now();
		const upload = await prepareUpload(raster, img, s.gemini.maxSide);
		mark("encodeUpload", t0);
		const canvas = raster.createCanvas(img.width, img.height);
		const c2d = canvas.getContext("2d", { willReadFrequently: true });
		c2d.drawImage(img.source, 0, 0);
		img.close?.();
		const id = c2d.getImageData(0, 0, img.width, img.height);
		const rasterData = {
			data: id.data,
			width: id.width,
			height: id.height
		};
		const gapClear = (band) => bandIsClear(rasterData, band);
		const ctx = { ...input.ctx };
		let regions = [];
		let provider = "";
		let sourceLang = ctx.sourceLang;
		let useOneshot = !!s.stages.oneshot && !!s.keys.gemini;
		if (useOneshot) {
			t0 = performance.now();
			try {
				const r = await runOneshot(upload, ctx, s, signal, log);
				regions = r.regions;
				provider = r.provider;
				mark("oneshot", t0);
			} catch (e) {
				if (e?.name === "AbortError") throw e;
				log(`oneshot failed → falling back to OCR + translate: ${e.message}`);
				useOneshot = false;
			}
		}
		if (!useOneshot) {
			t0 = performance.now();
			const ocr = await runOcr(upload, s, signal, log);
			mark("ocr", t0);
			if (ctx.sourceLang === "auto" && ocr.language) ctx.sourceLang = LANG_FROM_LENS[ocr.language] ?? ocr.language;
			sourceLang = ctx.sourceLang;
			regions = sortReadingOrder(filterRegions(splitOverlapping(mergeLines(dropFurigana(ocr.lines), { gapClear }), gapClear), img.width, img.height), ctx.sourceLang === "ja");
			tagSfx(regions);
			if (!s.stages.sfx) regions = regions.filter((r) => r.kind !== "sfx");
			t0 = performance.now();
			if (regions.length) {
				const tr = await runTranslate(regions.map((r) => r.src), ctx, s, signal, log);
				tr.dst.forEach((d, i) => regions[i].dst = d);
				provider = `${ocr.provider}+${tr.provider}`;
			} else provider = ocr.provider;
			mark("translate", t0);
		}
		regions = regions.filter((r) => r.src && r.dst && r.dst.trim() !== r.src.trim());
		t0 = performance.now();
		if (regions.length) {
			for (const r of regions) r.layout = estimateLayoutRect(rasterData, r, eraseRegion(rasterData, r, { mode: s.stages.erase }));
			resolveLayoutOverlaps(regions);
			c2d.putImageData(id, 0, 0);
			mark("erase", t0);
			t0 = performance.now();
			for (const r of regions) {
				const lay = drawRegion(c2d, r, s.render);
				r.fontPx = lay?.fontPx;
				r.lineCount = lay?.lines.length;
			}
			mark("render", t0);
		}
		t0 = performance.now();
		const outMime = input.outMime ?? "image/jpeg";
		const out = await raster.encode(canvas, outMime, input.outQuality ?? .92);
		mark("encode", t0);
		return {
			regions,
			width: img.width,
			height: img.height,
			out,
			outMime,
			provider,
			sourceLang,
			timings: t,
			empty: regions.length === 0
		};
	}
	var Scheduler = class {
		opts;
		tasks = new Map();
		pages = [];
		current = 1;
		running = 0;
		paused = false;
		pumping = false;
		window;
		concurrency;
		constructor(opts) {
			this.opts = opts;
			this.window = opts.window;
			this.concurrency = opts.concurrency;
		}
		setPages(pages) {
			this.pages = pages;
			for (const p of pages) if (!this.tasks.has(p.index)) this.tasks.set(p.index, {
				page: p,
				state: "queued",
				attempts: 0
			});
		}
		setCurrent(index) {
			if (index === this.current) return;
			this.current = index;
			for (const t of this.tasks.values()) if (t.state === "running" && (t.page.index < index || t.page.index > index + this.window)) t.controller?.abort();
			this.pump();
		}
		setPaused(p) {
			this.paused = p;
			if (!p) this.pump();
		}
		invalidate(index) {
			for (const t of this.tasks.values()) {
				if (index !== void 0 && t.page.index !== index) continue;
				if (t.state === "running") t.controller?.abort();
				t.state = "queued";
				t.attempts = 0;
				t.error = void 0;
			}
			this.pump();
		}
		markDone(index) {
			const t = this.tasks.get(index);
			if (t && t.state !== "running") {
				t.state = "done";
				this.opts.onChange?.(t);
			}
		}
		get(index) {
			return this.tasks.get(index);
		}
		snapshot() {
			let queued = 0, done = 0, failed = 0;
			for (const t of this.tasks.values()) if (t.state === "queued") queued++;
			else if (t.state === "done") done++;
			else if (t.state === "failed") failed++;
			return {
				current: this.current,
				running: this.running,
				queued,
				done,
				failed
			};
		}
		pump() {
			if (this.pumping) return;
			this.pumping = true;
			queueMicrotask(() => {
				this.pumping = false;
				if (this.paused) return;
				while (this.running < this.concurrency) {
					const next = this.pickNext();
					if (!next) break;
					this.start(next);
				}
			});
		}
		pickNext() {
			const max = this.opts.maxAttempts ?? 2;
			for (let i = this.current; i <= this.current + this.window; i++) {
				const t = this.tasks.get(i);
				if (t && t.state === "queued" && t.attempts < max) return t;
			}
		}
		start(t) {
			t.state = "running";
			t.attempts++;
			t.controller = new AbortController();
			this.running++;
			this.opts.onChange?.(t);
			this.opts.run(t.page, t.controller.signal).then(() => {
				t.state = "done";
				t.error = void 0;
			}).catch((e) => {
				if (e?.name === "AbortError" || t.controller?.signal.aborted) {
					t.state = "queued";
					t.attempts--;
				} else {
					t.error = e?.message ?? String(e);
					const max = this.opts.maxAttempts ?? 2;
					t.state = t.attempts >= max ? "failed" : "queued";
				}
			}).finally(() => {
				this.running--;
				this.opts.onChange?.(t);
				this.pump();
			});
		}
	};
	var DEFAULT_SETTINGS = {
		preset: "no-key",
		enabled: true,
		targetLang: "ko",
		sourceLang: "auto",
		stages: {
			oneshot: null,
			ocr: "lens",
			translate: [
				"papago",
				"deepl",
				"google-unofficial"
			],
			googleForJaKo: false,
			erase: "flat-fill+diffuse",
			sfx: false
		},
		keys: { gemini: "" },
		gemini: {
			model: "gemini-2.5-flash-lite",
			fallbackModels: ["gemini-2.5-flash", "gemini-2.0-flash"],
			maxSide: 1536
		},
		prefetch: {
			pages: 3,
			mobilePages: 2,
			concurrency: 2
		},
		render: {
			font: "\"Noto Sans KR\", \"Apple SD Gothic Neo\", \"Malgun Gothic\", \"NanumGothic\", sans-serif",
			minFontPx: 10,
			maxFontPx: 64,
			bold: true,
			floorRatio: .015
		},
		debug: false
	};
	var KEY = "miri.settings.v1";
	function applyPreset(s, preset) {
		const next = structuredClone(s);
		next.preset = preset;
		if (preset === "cloud-oneshot") {
			next.stages.oneshot = "gemini-oneshot";
			next.stages.translate = [
				"gemini-text",
				"papago",
				"deepl",
				"google-unofficial"
			];
		} else if (preset === "no-key") {
			next.stages.oneshot = null;
			next.stages.ocr = "lens";
			next.stages.translate = [
				"papago",
				"deepl",
				"google-unofficial"
			];
		}
		return next;
	}
	function deepMerge(base, patch) {
		if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch ?? base;
		const out = Array.isArray(base) ? [...base] : { ...base };
		for (const k of Object.keys(patch)) out[k] = k in base && typeof base[k] === "object" && !Array.isArray(base[k]) ? deepMerge(base[k], patch[k]) : patch[k];
		return out;
	}
	async function loadSettings() {
		const raw = await gmGet(KEY, null);
		if (!raw) return structuredClone(DEFAULT_SETTINGS);
		try {
			const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
			if (typeof merged.stages.translate === "string") {
				const one = merged.stages.translate;
				merged.stages.translate = one === "gemini-text" ? [
					"gemini-text",
					"papago",
					"deepl",
					"google-unofficial"
				] : [
					"papago",
					"deepl",
					"google-unofficial"
				];
			}
			return merged;
		} catch {
			return structuredClone(DEFAULT_SETTINGS);
		}
	}
	async function saveSettings(s) {
		await gmSet(KEY, JSON.stringify(s));
	}
	function settingsSignature(s) {
		return [
			`v2`,
			s.targetLang,
			s.sourceLang,
			s.stages.oneshot ?? `${s.stages.ocr}+${s.stages.translate.join(">")}${s.stages.googleForJaKo ? "+g" : ""}`,
			s.stages.oneshot ? s.gemini.model : "",
			s.stages.erase,
			s.stages.sfx ? "sfx" : "",
			`f${s.render.floorRatio}${s.render.bold ? "b" : ""}`
		].join("|");
	}
	var CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif; }
.fab { position: fixed; right: 12px; z-index: 2147483000; width: 44px; height: 44px; border-radius: 22px; border: none;
  background: #1f2937; color: #fff; font-size: 13px; font-weight: 700; box-shadow: 0 4px 14px rgba(0,0,0,.35); cursor: pointer;
  display: flex; align-items: center; justify-content: center; letter-spacing: -0.5px; }
.fab.working { background: #2563eb; animation: pulse 1.2s infinite; }
.fab.error { background: #b91c1c; }
.fab.off { background: #6b7280; }
@keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(37,99,235,.6)} 70%{box-shadow:0 0 0 12px rgba(37,99,235,0)} 100%{box-shadow:0 0 0 0 rgba(37,99,235,0)} }
.eye { position: fixed; right: 64px; z-index: 2147483000; width: 44px; height: 44px; border-radius: 22px; border: none;
  background: #374151; color: #fff; font-size: 18px; box-shadow: 0 4px 14px rgba(0,0,0,.35); cursor: pointer; }
.panel { position: fixed; right: 12px; z-index: 2147483001; width: min(360px, calc(100vw - 24px)); max-height: 70vh; overflow: auto;
  background: #fff; color: #111; border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.35); padding: 14px; font-size: 13px; display: none; }
.panel.open { display: block; }
h1 { font-size: 15px; margin: 0 0 10px; display: flex; justify-content: space-between; align-items: center; }
h1 small { font-weight: 400; color: #6b7280; font-size: 11px; }
.row { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
.row label { flex: 0 0 92px; color: #374151; }
.row select, .row input[type=text], .row input[type=password], .row input[type=number] { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; background: #fff; color: #111; }
.btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
button.b { padding: 7px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb; color: #111; font-size: 12px; cursor: pointer; }
button.b.primary { background: #1f2937; color: #fff; border-color: #1f2937; }
.status { margin-top: 10px; padding: 8px; border-radius: 8px; background: #f3f4f6; color: #374151; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.status.error { background: #fef2f2; color: #991b1b; }
.hint { color: #6b7280; font-size: 11px; margin: 2px 0 0 100px; }
.sec { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-weight: 700; color: #111; }
`;
	var Panel = class {
		cb;
		version;
		host;
		root;
		fab;
		eye;
		panel;
		statusEl;
		settings;
		showingOriginal = false;
		constructor(settings, cb, bottomOffset = 16, version = "dev") {
			this.cb = cb;
			this.version = version;
			this.settings = settings;
			this.host = document.createElement("div");
			this.host.id = "miri-translator-ui";
			this.root = this.host.attachShadow({ mode: "open" });
			const style = document.createElement("style");
			style.textContent = CSS;
			this.root.appendChild(style);
			this.build(bottomOffset);
			document.documentElement.appendChild(this.host);
		}
		build(bottom) {
			this.fab = document.createElement("button");
			this.fab.className = "fab";
			this.fab.textContent = "번역";
			this.fab.style.bottom = `${bottom}px`;
			this.fab.title = "MiriTranslator 설정";
			this.fab.addEventListener("click", () => this.panel.classList.toggle("open"));
			this.eye = document.createElement("button");
			this.eye.className = "eye";
			this.eye.textContent = "👁";
			this.eye.style.bottom = `${bottom}px`;
			this.eye.title = "원본/번역 전환 (이미지를 길게 눌러도 됨)";
			this.eye.addEventListener("click", () => {
				this.showingOriginal = !this.showingOriginal;
				this.eye.style.opacity = this.showingOriginal ? "0.55" : "1";
				this.cb.onToggleOriginal();
			});
			this.panel = document.createElement("div");
			this.panel.className = "panel";
			this.panel.style.bottom = `${bottom + 52}px`;
			this.renderPanel();
			this.statusEl = document.createElement("div");
			this.statusEl.className = "status";
			this.statusEl.textContent = "대기 중";
			this.panel.appendChild(this.statusEl);
			this.root.append(this.fab, this.eye, this.panel);
		}
		renderPanel() {
			const s = this.settings;
			this.panel.innerHTML = "";
			const h = document.createElement("h1");
			h.innerHTML = `MiriTranslator <small>v${this.version}</small>`;
			this.panel.appendChild(h);
			const row = (label, el, hint) => {
				const r = document.createElement("div");
				r.className = "row";
				const l = document.createElement("label");
				l.textContent = label;
				r.append(l, el);
				this.panel.appendChild(r);
				if (hint) {
					const p = document.createElement("div");
					p.className = "hint";
					p.textContent = hint;
					this.panel.appendChild(p);
				}
			};
			const select = (value, options, onChange) => {
				const el = document.createElement("select");
				for (const [v, t] of options) {
					const o = document.createElement("option");
					o.value = v;
					o.textContent = t;
					if (v === value) o.selected = true;
					el.appendChild(o);
				}
				el.addEventListener("change", () => onChange(el.value));
				return el;
			};
			const input = (type, value, onChange, placeholder = "") => {
				const el = document.createElement("input");
				el.type = type;
				el.value = value;
				el.placeholder = placeholder;
				el.addEventListener("change", () => onChange(el.value));
				return el;
			};
			const checkbox = (checked, onChange) => {
				const el = document.createElement("input");
				el.type = "checkbox";
				el.checked = checked;
				el.addEventListener("change", () => onChange(el.checked));
				return el;
			};
			const commit = (reprocess) => this.cb.onSettingsChange(this.settings, reprocess);
			row("켜기", checkbox(s.enabled, (v) => {
				s.enabled = v;
				commit(false);
			}));
			row("프리셋", select(s.preset, [
				["no-key", "무키 — Lens OCR + Google 번역 (키 없음)"],
				["cloud-oneshot", "클라우드 원샷 — Gemini (키 필요)"],
				["custom", "직접 설정"]
			], (v) => {
				this.settings = applyPreset(this.settings, v);
				this.renderPanel();
				this.panel.appendChild(this.statusEl);
				commit(true);
			}));
			if (s.preset === "custom") {
				row("OCR/원샷", select(s.stages.oneshot ?? s.stages.ocr, [["lens", "Google Lens OCR (키 없음)"], ["gemini-oneshot", "Gemini 원샷 (검출+OCR+번역)"]], (v) => {
					if (v === "gemini-oneshot") s.stages.oneshot = v;
					else {
						s.stages.oneshot = null;
						s.stages.ocr = v;
					}
					commit(true);
				}));
				row("번역", select(s.stages.translate[0] ?? "papago", [
					["papago", "Papago 비공식 → DeepL → Google (일→한 추천)"],
					["deepl", "DeepL 비공식 → Papago → Google"],
					["google-unofficial", "Google 비공식 → Papago → DeepL"],
					["gemini-text", "Gemini 텍스트(키 필요) → Papago → DeepL → Google"]
				], (v) => {
					const rest = [
						"papago",
						"deepl",
						"google-unofficial"
					].filter((id) => id !== v);
					s.stages.translate = [v, ...rest];
					commit(true);
				}), "순서대로 시도하고 실패(429 등)하면 다음으로 넘어갑니다.");
				row("일→한 Google", checkbox(s.stages.googleForJaKo, (v) => {
					s.stages.googleForJaKo = v;
					commit(true);
				}), "끄면 일본어→한국어에서는 Google을 마지막 수단으로만 씁니다(문장 누락 때문).");
			}
			row("Gemini 키", input("password", s.keys.gemini, (v) => {
				s.keys.gemini = v.trim();
				commit(true);
			}, "AIza... (aistudio.google.com 무료)"), s.preset === "no-key" ? "무키 프리셋에서는 필요 없음" : void 0);
			row("Gemini 모델", select(s.gemini.model, [
				["gemini-2.5-flash-lite", "gemini-2.5-flash-lite (빠름, 일일 한도 넉넉)"],
				["gemini-2.5-flash", "gemini-2.5-flash (품질↑, 한도↓)"],
				["gemini-2.0-flash", "gemini-2.0-flash"],
				["gemini-3-flash-preview", "gemini-3-flash-preview"]
			], (v) => {
				s.gemini.model = v;
				commit(true);
			}));
			row("원문 언어", select(s.sourceLang, [
				["auto", "자동 (사이트 태그/OCR 감지)"],
				["ja", "일본어"],
				["en", "영어"],
				["zh", "중국어"],
				["ko", "한국어"]
			], (v) => {
				s.sourceLang = v;
				commit(true);
			}));
			row("지우기", select(s.stages.erase, [
				["flat-fill+diffuse", "색 채우기 + 확산 (기본)"],
				["flat-fill", "색 채우기만 (가장 빠름)"],
				["overlay", "지우지 않고 덮어쓰기"]
			], (v) => {
				s.stages.erase = v;
				commit(true);
			}));
			row("효과음", checkbox(s.stages.sfx, (v) => {
				s.stages.sfx = v;
				commit(true);
			}));
			row("최소 글자", select(String(s.render.floorRatio), [
				["0.012", "작게 (페이지 너비의 1.2%)"],
				["0.015", "보통 (1.5%)"],
				["0.018", "크게 (1.8%)"],
				["0", "제한 없음 (말풍선에 맞춤)"]
			], (v) => {
				s.render.floorRatio = parseFloat(v) || 0;
				commit(true);
			}), "이보다 작아지면 글자 단위로 줄을 바꾸고, 그래도 안 되면 말풍선 밖으로 조금 키웁니다");
			row("선처리 페이지", input("number", String(s.prefetch.pages), (v) => {
				s.prefetch.pages = Math.max(0, Math.min(10, parseInt(v, 10) || 0));
				commit(false);
			}), "현재 페이지 뒤로 몇 장을 미리 처리할지");
			row("디버그 로그", checkbox(s.debug, (v) => {
				s.debug = v;
				commit(false);
			}));
			const btns = document.createElement("div");
			btns.className = "btns";
			const mk = (label, primary, fn) => {
				const b = document.createElement("button");
				b.className = `b${primary ? " primary" : ""}`;
				b.textContent = label;
				b.addEventListener("click", fn);
				btns.appendChild(b);
			};
			mk("지금 번역", true, () => this.cb.onTranslateNow());
			mk("원본/번역 전환", false, () => this.eye.click());
			mk("캐시 비우기", false, async () => {
				await this.cb.onClearCache();
				this.setStatus({
					state: "idle",
					text: "캐시를 비웠습니다"
				});
			});
			this.panel.appendChild(btns);
		}
		setStatus(st) {
			this.fab.className = `fab ${st.state}`;
			this.statusEl.className = `status${st.state === "error" ? " error" : ""}`;
			this.statusEl.textContent = st.detail ? `${st.text}\n${st.detail}` : st.text;
			if (st.state === "working") this.fab.textContent = "…";
			else if (st.state === "error") this.fab.textContent = "!";
			else this.fab.textContent = "번역";
		}
		get isShowingOriginal() {
			return this.showingOriginal;
		}
	};
	var ADAPTERS = [kHentaiAdapter];
	function platform() {
		const ua = navigator.userAgent;
		if (/Android/i.test(ua)) return "android";
		if (/iPhone|iPad|iPod/i.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return "ios";
		return "desktop";
	}
	async function main() {
		const adapter = ADAPTERS.find((a) => a.matches(location));
		if (!adapter) return;
		const session = await adapter.init();
		if (!session) {
			console.warn("[miri] adapter could not read the page");
			return;
		}
		let settings = await loadSettings();
		const log = (...a) => settings.debug && console.log("[miri]", ...a);
		const plat = platform();
		const results = new Map();
		const ctx = {
			sourceLang: settings.sourceLang === "auto" ? session.sourceLang ?? "auto" : settings.sourceLang,
			targetLang: settings.targetLang,
			history: [],
			glossary: {}
		};
		const histories = new Map();
		const contextFor = (index) => {
			const hist = [];
			for (let i = index - 1; i >= 1 && hist.length < 24; i--) {
				const h = histories.get(i);
				if (h) hist.unshift(...h.slice(-12));
			}
			return {
				...ctx,
				history: hist.slice(-24)
			};
		};
		let panel;
		const status = (state, text, detail) => panel?.setStatus({
			state,
			text,
			detail
		});
		const describe = () => {
			const snap = scheduler.snapshot();
			const cur = results.get(session.currentIndex());
			const t = cur?.timings ? Object.entries(cur.timings).map(([k, v]) => `${k} ${v}ms`).join(" · ") : "";
			const lang = ctx.sourceLang === "auto" ? "자동" : ctx.sourceLang;
			return {
				text: `페이지 ${snap.current}/${session.pages.length} · 완료 ${snap.done} · 처리 중 ${snap.running} · 실패 ${snap.failed} · 원문 ${lang}`,
				detail: cur ? `${cur.fromCache ? "캐시" : cur.provider} · 영역 ${cur.regions.length}${t ? ` · ${t}` : ""}` : void 0
			};
		};
		const fetchBytes = async (page, signal) => {
			const r = await gmRequest({
				url: page.url,
				method: "GET",
				headers: session.referer ? { Referer: session.referer } : void 0,
				signal,
				anonymous: false,
				timeoutMs: 6e4
			});
			if (r.status < 200 || r.status >= 300) throw new Error(`image HTTP ${r.status}`);
			return new Uint8Array(r.body);
		};
		const processPage = async (page, signal) => {
			if (!settings.enabled) return;
			if (results.has(page.index)) return;
			const tFetch = performance.now();
			const bytes = await fetchBytes(page, signal);
			const fetchMs = Math.round(performance.now() - tFetch);
			const key = `${await sha1Hex(bytes)}|${settingsSignature(settings)}`;
			const cached = await pageCache.get(key);
			if (cached) {
				const url = URL.createObjectURL(cached.blob);
				results.set(page.index, {
					url,
					regions: cached.regions,
					provider: cached.provider,
					fromCache: true
				});
				histories.set(page.index, cached.regions.map((r) => ({
					src: r.src,
					dst: r.dst
				})));
				log(`page ${page.index}: cache hit (fetch ${fetchMs}ms, ${Math.round(bytes.length / 1024)} kB)`);
				applyAll();
				return;
			}
			const out = await translatePage({
				bytes,
				ctx: contextFor(page.index),
				settings,
				raster: browserRaster,
				signal,
				log
			});
			if (ctx.sourceLang === "auto" && out.sourceLang !== "auto") ctx.sourceLang = out.sourceLang;
			const blob = new Blob([out.out], { type: out.outMime });
			const url = URL.createObjectURL(blob);
			results.set(page.index, {
				url,
				regions: out.regions,
				provider: out.provider,
				fromCache: false,
				timings: out.timings
			});
			histories.set(page.index, out.regions.map((r) => ({
				src: r.src,
				dst: r.dst
			})));
			log(`page ${page.index}: ${out.regions.length} regions via ${out.provider} — fetch ${fetchMs}ms (${Math.round(bytes.length / 1024)} kB) · ` + Object.entries(out.timings).map(([k, v]) => `${k} ${v}ms`).join(" · "));
			pageCache.put({
				key,
				blob,
				mime: out.outMime,
				regions: out.regions,
				width: out.width,
				height: out.height,
				provider: out.provider,
				createdAt: Date.now(),
				bytes: blob.size
			});
			applyAll();
		};
		const scheduler = new Scheduler({
			run: processPage,
			window: plat === "desktop" ? settings.prefetch.pages : Math.min(settings.prefetch.pages, settings.prefetch.mobilePages),
			concurrency: settings.prefetch.concurrency,
			onChange: (task) => {
				const snap = scheduler.snapshot();
				const d = describe();
				if (task.state === "failed") status("error", d.text, `p.${task.page.index} 실패: ${task.error}`);
				else status(snap.running ? "working" : "idle", d.text, d.detail);
			}
		});
		let showOriginal = false;
		const applyAll = () => {
			const els = session.imageElements();
			for (const [idx, img] of els) {
				const res = results.get(idx);
				if (!res) continue;
				const want = showOriginal ? "original" : "translated";
				if (img.dataset.miriState === want && (want === "original" || img.getAttribute("src") === res.url)) continue;
				if (!img.dataset.miriOrig) img.dataset.miriOrig = img.dataset.src || img.getAttribute("src") || session.pages[idx - 1].url;
				const target = want === "translated" ? res.url : img.dataset.miriOrig;
				img.dataset.miriState = want;
				if (img.srcset) img.srcset = "";
				if (img.dataset.src !== void 0) img.dataset.src = target;
				img.src = target;
				img.classList.toggle("miri-translated", want === "translated");
			}
		};
		session.onImagesChanged(applyAll);
		let pressTimer;
		const pressTarget = (ev) => {
			const el = ev.target;
			return el && el.tagName === "IMG" && el.dataset.miriState ? el : null;
		};
		document.addEventListener("pointerdown", (ev) => {
			const img = pressTarget(ev);
			if (!img) return;
			pressTimer = window.setTimeout(() => {
				const idx = [...session.imageElements()].find(([, e]) => e === img)?.[0];
				const res = idx ? results.get(idx) : void 0;
				if (!res) return;
				const toOrig = img.dataset.miriState === "translated";
				img.dataset.miriState = toOrig ? "original" : "translated";
				img.src = toOrig ? img.dataset.miriOrig : res.url;
			}, 450);
		}, { passive: true });
		for (const evn of [
			"pointerup",
			"pointercancel",
			"pointermove"
		]) document.addEventListener(evn, () => pressTimer && window.clearTimeout(pressTimer), { passive: true });
		panel = new Panel(settings, {
			onSettingsChange: async (next, reprocess) => {
				const langChanged = next.sourceLang !== settings.sourceLang;
				settings = next;
				await saveSettings(settings);
				scheduler.window = plat === "desktop" ? settings.prefetch.pages : Math.min(settings.prefetch.pages, settings.prefetch.mobilePages);
				if (langChanged) ctx.sourceLang = settings.sourceLang === "auto" ? session.sourceLang ?? "auto" : settings.sourceLang;
				if (!settings.enabled) {
					scheduler.setPaused(true);
					showOriginal = true;
					applyAll();
					status("off", "꺼짐");
					return;
				}
				scheduler.setPaused(false);
				if (reprocess) {
					for (const r of results.values()) URL.revokeObjectURL(r.url);
					results.clear();
					histories.clear();
					scheduler.invalidate();
				}
				showOriginal = false;
				applyAll();
				scheduler.pump();
			},
			onToggleOriginal: () => {
				showOriginal = !showOriginal;
				applyAll();
			},
			onTranslateNow: () => {
				const idx = session.currentIndex();
				if (!results.has(idx)) scheduler.invalidate(idx);
				scheduler.setCurrent(idx);
				scheduler.pump();
			},
			onClearCache: () => pageCache.clear()
		}, session.uiBottomOffset ?? 16, scriptVersion());
		gmMenu("MiriTranslator: 원본/번역 전환", () => panel["eye"].click());
		if (session.alreadyTranslated && settings.sourceLang === "auto") {
			status("off", "이미 한국어 갤러리입니다 (원문 언어를 수동으로 바꾸면 번역합니다)");
			return;
		}
		scheduler.setPages(session.pages);
		scheduler.setCurrent(session.currentIndex());
		session.onNavigate((i) => {
			scheduler.setCurrent(i);
			const d = describe();
			status(scheduler.snapshot().running ? "working" : "idle", d.text, d.detail);
		});
		status(settings.enabled ? "working" : "off", `시작: ${session.pages.length}페이지, 원문 ${ctx.sourceLang}`);
		scheduler.pump();
		log("session", session.chapterId, session.pages.length, "pages, lang", session.sourceLang, "platform", plat);
	}
	main().catch((e) => console.error("[miri] fatal", e));
})();
