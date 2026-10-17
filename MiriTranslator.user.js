// ==UserScript==
// @name         MiriTranslator
// @namespace    https://github.com/enflip/MiriTranslator
// @version      0.5.1
// @author       MiriTranslator contributors
// @description  가벼운 브라우저 만화 번역기 — 로컬 지우기·조판 + 무료 API, 서버 불필요. Lightweight in-browser manga translator.
// @license      MIT
// @homepageURL  https://github.com/enflip/MiriTranslator-release
// @supportURL   https://github.com/enflip/MiriTranslator-release/issues
// @downloadURL  https://raw.githubusercontent.com/enflip/MiriTranslator-release/main/MiriTranslator.user.js
// @updateURL    https://raw.githubusercontent.com/enflip/MiriTranslator-release/main/MiriTranslator.meta.js
// @match        *://*/*
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
	var g = globalThis;
	typeof g.GM_xmlhttpRequest === "function" || typeof g.GM !== "undefined" && g.GM?.xmlHttpRequest, typeof g.GM_getValue === "function" || typeof g.GM !== "undefined" && g.GM?.getValue, g.GM_registerMenuCommand;
	var transport = null;
	function gmRequest(req) {
		if (transport) return transport(req);
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
	var MIN_SIDE = 200;
	var MAX_RATIO = 2.5;
	var SITES_KEY = "miri.sites.v1";
	async function isSiteEnabled(host) {
		const list = await gmGet(SITES_KEY, []);
		return Array.isArray(list) && list.includes(host);
	}
	async function setSiteEnabled(host, on) {
		const list = await gmGet(SITES_KEY, []);
		const cur = Array.isArray(list) ? list : [];
		await gmSet(SITES_KEY, on ? Array.from(new Set([...cur, host])) : cur.filter((h) => h !== host));
	}
	function abs(v) {
		if (!v) return "";
		try {
			return new URL(v, location.href).href;
		} catch {
			return "";
		}
	}
	var IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|jxl)(\?|#|$)/i;
	var isPlaceholder = (u) => !u || /^data:/i.test(u) || /transparen|blank|placeholder|spacer|loading|1x1|px\.(gif|png)/i.test(u);
	function lazyUrl(img) {
		const vals = Object.values(img.dataset).filter((v) => typeof v === "string" && v.length > 0);
		const ext = vals.find((v) => IMG_EXT.test(v));
		const any = vals.find((v) => /^(https?:)?\/\/|^\/|^\.\.?\//.test(v) && !/^data:/i.test(v));
		const pick = ext || any;
		return pick ? abs(pick) : "";
	}
	function srcsetUrl(v) {
		return abs(v.split(",")[0]?.trim().split(/\s+/)[0] ?? "");
	}
	function pictureUrl(img) {
		const pic = img.parentElement;
		if (!pic || pic.tagName !== "PICTURE") return "";
		for (const s of Array.from(pic.querySelectorAll("source"))) {
			const u = srcsetUrl(s.getAttribute("srcset") || s.getAttribute("data-srcset") || "");
			if (u) return u;
		}
		return "";
	}
	function deferredUrl(img) {
		return lazyUrl(img) || pictureUrl(img) || (img.srcset ? srcsetUrl(img.srcset) : "");
	}
	function imgUrl(img) {
		const orig = img.dataset.miriOrig;
		if (orig) {
			const a = abs(orig);
			if (a) return a;
		}
		if (img.dataset.miriState) return "";
		const lazy = lazyUrl(img);
		const cur = img.currentSrc || img.src || "";
		const usable = /^data:/i.test(cur) ? "" : cur;
		const absCur = usable ? abs(usable) : "";
		if (lazy && (img.naturalWidth <= 2 || !absCur || isPlaceholder(cur))) return lazy;
		return absCur || deferredUrl(img);
	}
	var shaped = (w, h) => w >= MIN_SIDE && h >= MIN_SIDE && w / h < MAX_RATIO;
	function isCandidate(img) {
		if (img.closest("header,footer,nav,aside")) return false;
		const url = imgUrl(img);
		if (!url || /^data:/i.test(url)) return false;
		const r = img.getBoundingClientRect();
		if (r.width > 2 && r.height > 2) return shaped(r.width, r.height);
		return !!img.dataset.miriOrig || deferredUrl(img) !== "";
	}
	function collect() {
		const out = [];
		const walk = (root, depth) => {
			if (depth > 2) return;
			try {
				out.push(...Array.from(root.querySelectorAll("img")));
				for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
				else if (el.tagName === "IFRAME") try {
					walk(el.contentDocument, depth + 1);
				} catch {}
			} catch {}
		};
		walk(document, 0);
		return out;
	}
	var genericAdapter = {
		id: "generic",
		matches: (loc) => /^https?:$/.test(loc.protocol),
		isEnabled: () => isSiteEnabled(location.hostname),
		async init() {
			const urlToIndex = new Map();
			const pages = [];
			let indexToEl = new Map();
			let nextIndex = 1;
			let last = 1;
			const scan = () => {
				const elFor = new Map();
				let added = false;
				for (const img of collect()) {
					if (!isCandidate(img)) continue;
					const url = imgUrl(img);
					if (!url) continue;
					let idx = urlToIndex.get(url);
					if (idx === void 0) {
						idx = nextIndex++;
						urlToIndex.set(url, idx);
						pages[idx - 1] = {
							index: idx,
							url
						};
						added = true;
					}
					const p = pages[idx - 1];
					p.url = url;
					if (img.naturalWidth > 2) {
						p.width = img.naturalWidth;
						p.height = img.naturalHeight;
					}
					if (!elFor.has(idx)) elFor.set(idx, img);
				}
				indexToEl = elFor;
				return added;
			};
			scan();
			const currentPage = () => {
				const vw = window.innerWidth;
				const vh = window.innerHeight;
				let best = 0;
				let bestArea = -1;
				let bestD = Infinity;
				for (const [idx, img] of indexToEl) {
					if (!img.isConnected) continue;
					const r = img.getBoundingClientRect();
					if (r.width <= 0 || r.height <= 0) continue;
					const w = Math.min(r.right, vw) - Math.max(r.left, 0);
					const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
					const area = w > 0 && h > 0 ? w * h : 0;
					const d = Math.hypot(r.left + r.width / 2 - vw / 2, r.top + r.height / 2 - vh / 2);
					if (area > bestArea || area === bestArea && d < bestD) {
						bestArea = area;
						bestD = d;
						best = idx;
					}
				}
				return best || last || 1;
			};
			last = currentPage();
			const navCbs = new Set();
			const notify = (index) => {
				if (index === last) return;
				last = index;
				navCbs.forEach((cb) => cb(index));
			};
			let raf = 0;
			const onViewport = () => {
				if (raf) return;
				raf = requestAnimationFrame(() => {
					raf = 0;
					notify(currentPage());
				});
			};
			window.addEventListener("scroll", onViewport, { passive: true });
			window.addEventListener("resize", onViewport, { passive: true });
			setInterval(() => notify(currentPage()), 350);
			const imgCbs = new Set();
			let timer;
			const refresh = () => {
				scan();
				notify(currentPage());
				imgCbs.forEach((cb) => cb());
			};
			new MutationObserver(() => {
				clearTimeout(timer);
				timer = setTimeout(refresh, 300);
			}).observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: [
					"src",
					"srcset",
					"data-src"
				]
			});
			return {
				chapterId: `generic:${location.host}${location.pathname}`,
				pages,
				sourceLang: null,
				referer: location.href,
				currentIndex: () => last,
				onNavigate(cb) {
					navCbs.add(cb);
					return () => navCbs.delete(cb);
				},
				imageElements() {
					scan();
					return new Map(indexToEl);
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
	var URLS = "urls";
	var DB_VERSION = 2;
	var MAX_ENTRIES = 400;
	var MAX_BYTES$1 = 262144e3;
	var MAX_URLS = 2e3;
	var dbp = null;
	function open() {
		if (dbp) return dbp;
		dbp = new Promise((resolve, reject) => {
			if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
			const req = indexedDB.open(DB, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" }).createIndex("createdAt", "createdAt");
				if (!db.objectStoreNames.contains(URLS)) db.createObjectStore(URLS, { keyPath: "url" }).createIndex("createdAt", "createdAt");
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		return dbp;
	}
	function tx(store, mode, fn) {
		return open().then((db) => new Promise((resolve, reject) => {
			const t = db.transaction(store, mode);
			const st = t.objectStore(store);
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
				return await tx(STORE, "readonly", (st) => st.get(key));
			} catch {
				return;
			}
		},
		async put(entry) {
			try {
				await tx(STORE, "readwrite", (st) => void st.put(entry));
				this.trim();
			} catch {}
		},
		async getKey(url, sig) {
			try {
				const rec = await tx(URLS, "readonly", (st) => st.get(url));
				if (rec && rec.key.slice(rec.key.indexOf("|") + 1) === sig) return rec.key;
				return null;
			} catch {
				return null;
			}
		},
		async setKey(url, key) {
			try {
				await tx(URLS, "readwrite", (st) => void st.put({
					url,
					key,
					createdAt: Date.now()
				}));
				this.trimUrls();
			} catch {}
		},
		async clear() {
			try {
				await tx(STORE, "readwrite", (st) => void st.clear());
			} catch {}
			try {
				await tx(URLS, "readwrite", (st) => void st.clear());
			} catch {}
		},
		async stats() {
			try {
				const all = await tx(STORE, "readonly", (st) => st.getAll());
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
			const all = await tx(STORE, "readonly", (st) => st.getAll());
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
			await tx(STORE, "readwrite", (st) => {
				for (const k of victims) st.delete(k);
			});
			const urls = await tx(URLS, "readonly", (st) => st.getAll());
			const kept = new Set(all.filter((e) => !victims.includes(e.key)).map((e) => e.key));
			const dead = urls.filter((u) => !kept.has(u.key)).map((u) => u.url);
			if (dead.length) await tx(URLS, "readwrite", (st) => {
				for (const u of dead) st.delete(u);
			});
		},
		async trimUrls() {
			const all = await tx(URLS, "readonly", (st) => st.getAll());
			if (all.length <= MAX_URLS) return;
			all.sort((a, b) => a.createdAt - b.createdAt);
			const victims = all.slice(0, all.length - Math.floor(MAX_URLS * .8)).map((u) => u.url);
			await tx(URLS, "readwrite", (st) => {
				for (const u of victims) st.delete(u);
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
	function ringIsFlat(img, box, flatThreshold = 14) {
		const glyph = Math.max(6, Math.min(box.w, box.h));
		const rect = clipBox(padBox(box, clamp(Math.round(glyph * .12), 2, 12)), img.width, img.height);
		return sampleRing(img, rect, clipBox(padBox(rect, clamp(Math.round(glyph * .1), 3, 10)), img.width, img.height)).spread < flatThreshold;
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
	var RUBY_MARK_RE = /[〔［[]([^〔〕［］[\]]*)[〕］\]]/g;
	var INLINE_RUBY_RE = /(\S+?)⟨([^⟨⟩]+)⟩/g;
	var HIRAGANA_ONLY = /^[\u3040-\u309f\u30fc\u30fb\s]+$/;
	var KATAKANA_OR_KANJI = /[\u30a1-\u30fa\u30fd\u30fe\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\u3005\uf900-\ufaff]/;
	function classifyRuby(text) {
		const t = text.replace(/\s+/g, "");
		if (!t) return "ignore";
		if (HIRAGANA_ONLY.test(t)) return "ignore";
		if (KATAKANA_OR_KANJI.test(t)) return "translate";
		return "asis";
	}
	var NOT_RUBY = /[。、．，！？!?※（）()「」『』【】\[\]…:：;；♪♡☆★]/;
	function rubyCandidate(l) {
		const t = l.text.replace(/\s+/g, "");
		if (!t || NOT_RUBY.test(t)) return false;
		return HIRAGANA_ONLY.test(t) || t.length <= 16;
	}
	function rubyWordRange(base, ruby) {
		const words = base.words;
		if (!words?.length) return null;
		const span = (b) => base.vertical ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
		const [r0, r1] = span(ruby.box);
		let from = -1;
		let to = -1;
		words.forEach((w, i) => {
			const [w0, w1] = span(w.box);
			if (Math.min(r1, w1) - Math.max(r0, w0) < (w1 - w0) * .3) return;
			if (from < 0) from = i;
			to = i;
		});
		if (from < 0) {
			const rc = (r0 + r1) / 2;
			let best = 0;
			let bestD = Infinity;
			words.forEach((w, i) => {
				const [w0, w1] = span(w.box);
				const d = Math.abs((w0 + w1) / 2 - rc);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			});
			from = to = best;
		}
		return [from, to];
	}
	function markRubies(base, items) {
		if (!items.length) return;
		if (!base.words?.length) {
			base.text = `〔${base.text}〕`;
			base.rubies = [{
				kind: items.some((i) => i.note.kind === "translate") ? "translate" : "asis",
				text: items.map((i) => i.note.text).join(" ")
			}];
			return;
		}
		const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
		const merged = [];
		for (const it of sorted) {
			const last = merged[merged.length - 1];
			if (last && it.from <= last.to) {
				last.to = Math.max(last.to, it.to);
				last.notes.push(it.note);
			} else merged.push({
				from: it.from,
				to: it.to,
				notes: [it.note]
			});
		}
		const parts = [];
		const notes = [];
		base.words.forEach((w, i) => {
			const open = merged.find((m) => m.from === i);
			const close = merged.find((m) => m.to === i);
			let t = w.text;
			if (open) t = "〔" + t;
			if (close) {
				t += "〕";
				notes.push(close.notes.length === 1 ? close.notes[0] : {
					kind: close.notes.some((n) => n.kind === "translate") ? "translate" : "asis",
					text: close.notes.map((n) => n.text).join(" ")
				});
			}
			parts.push(t);
		});
		base.text = parts.join(" ").replace(/\s+([?!.,:;…）」』])/g, "$1").replace(/([（「『])\s+/g, "$1").trim();
		base.rubies = notes;
	}
	function rubyTextsToTranslate(regions) {
		const out = [];
		for (const r of regions) for (const n of r.rubies ?? []) if (n.kind === "translate" && !out.includes(n.text)) out.push(n.text);
		return out;
	}
	function stripRubyMarks(src) {
		return src.replace(RUBY_MARK_RE, "$1");
	}
	function applyRuby(region, dst, rubyTr) {
		const notes = region.rubies ?? [];
		const display = (n) => ((n.kind === "translate" ? rubyTr.get(n.text) : n.text) ?? n.text).replace(/[〔〕［］[\]⟨⟩]/g, "").trim();
		const groups = [...dst.matchAll(RUBY_MARK_RE)];
		const marks = [];
		let out = "";
		let last = 0;
		groups.forEach((m, i) => {
			out += dst.slice(last, m.index);
			const start = out.length;
			out += m[1];
			const end = out.length;
			last = m.index + m[0].length;
			if (groups.length === notes.length && end > start) {
				const text = display(notes[i]);
				if (text) marks.push({
					text,
					start,
					end
				});
			}
		});
		out += dst.slice(last);
		region.dst = out;
		region.src = stripRubyMarks(region.src);
		if (notes.length && groups.length !== notes.length) {
			const texts = notes.map(display).filter(Boolean);
			const first = out.match(/^\s*\S+/)?.[0] ?? out;
			if (texts.length && first.trim()) marks.push({
				text: texts.join(" "),
				start: first.length - first.trimStart().length,
				end: first.length
			});
		}
		region.rubyMarks = marks.length ? marks : void 0;
	}
	function parseInlineRuby(region) {
		const dst = region.dst;
		if (!dst.includes("⟨")) return;
		const marks = [];
		let out = "";
		let last = 0;
		for (const m of dst.matchAll(INLINE_RUBY_RE)) {
			out += dst.slice(last, m.index);
			const start = out.length;
			out += m[1];
			const end = out.length;
			last = m.index + m[0].length;
			const text = m[2].trim();
			if (text) marks.push({
				text,
				start,
				end
			});
		}
		out += dst.slice(last);
		region.dst = out.replace(/[⟨⟩]/g, "");
		region.rubyMarks = marks.length ? marks : void 0;
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
		let box = g.reduce((acc, l) => union(acc, l.box), g[0].box);
		for (const l of g) for (const rb of l.rubyBoxes ?? []) box = union(box, rb);
		const rubies = g.flatMap((l) => l.rubies ?? []);
		return {
			box,
			lines: g,
			src: joinLines(g.map((l) => l.text.trim()).filter(Boolean)),
			dst: "",
			kind: "unknown",
			vertical,
			...rubies.length ? { rubies } : {}
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
	var HAN = /\p{Script=Han}/u;
	function rubyBase(l, lines) {
		const g = glyphSize(l);
		const len = l.vertical ? l.box.h : l.box.w;
		let best = null;
		let bestGap = Infinity;
		for (const o of lines) {
			if (o === l || !!o.vertical !== !!l.vertical) continue;
			const G = glyphSize(o);
			if (G < g * 1.8) continue;
			const { gap, overlap } = relation(l, o);
			if (gap > G * .2 || gap < -Math.max(g, G * .5) || overlap < len * .5) continue;
			if (!(l.vertical ? l.box.x >= o.box.x + o.box.w * .5 : l.box.y + l.box.h <= o.box.y + o.box.h * .5)) continue;
			if (gap < bestGap) {
				bestGap = gap;
				best = o;
			}
		}
		return best;
	}
	function findRubyPairs(lines) {
		const pairs = [];
		for (const l of lines) {
			if (!rubyCandidate(l)) continue;
			const base = rubyBase(l, lines);
			if (base) pairs.push({
				ruby: l,
				base,
				gap: relation(l, base).gap
			});
		}
		return pairs;
	}
	function handleFurigana(lines, mode = "on") {
		if (lines.length < 2) return lines;
		const pairs = findRubyPairs(lines);
		if (!pairs.length) return lines;
		const rubies = new Set(pairs.map((p) => p.ruby));
		const sideNotes = new Set();
		const perBase = new Map();
		for (const { ruby, base } of pairs) {
			if (mode !== "on") {
				base.rubyBoxes = [...base.rubyBoxes ?? [], ruby.box];
				continue;
			}
			const kind = classifyRuby(ruby.text);
			if (kind === "ignore") continue;
			const range = rubyWordRange(base, ruby) ?? [0, 0];
			if (HAN.test(ruby.text) && base.words?.length && base.words.slice(range[0], range[1] + 1).some((w) => HAN.test(w.text))) {
				sideNotes.add(ruby);
				continue;
			}
			let list = perBase.get(base);
			if (!list) perBase.set(base, list = []);
			list.push({
				from: range[0],
				to: range[1],
				note: {
					text: ruby.text.replace(/\s+/g, ""),
					kind
				}
			});
		}
		if (mode === "on") {
			for (const { ruby, base } of pairs) if (!sideNotes.has(ruby)) base.rubyBoxes = [...base.rubyBoxes ?? [], ruby.box];
		}
		for (const [base, items] of perBase) markRubies(base, items);
		return lines.filter((l) => !rubies.has(l) || sideNotes.has(l));
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
	function tagSfx(regions, isFlat) {
		if (regions.length < 2) return;
		const glyphs = regions.map((r) => {
			const g = r.lines.map(glyphSize).sort((a, b) => a - b);
			return g.length ? g[g.length >> 1] : r.vertical ? r.box.w : r.box.h;
		});
		const med = glyphs.slice().sort((a, b) => a - b)[glyphs.length >> 1];
		regions.forEach((r, i) => {
			if (r.kind !== "unknown") return;
			if (r.lines.some((l) => l.rubyBoxes?.length)) return;
			const chars = r.src.replace(/\s/g, "").length;
			const tilted = r.lines.some((l) => l.angle !== void 0 && !l.vertical && Math.abs(l.angle) > .08);
			if (glyphs[i] > med * 2.2 && !/\p{Script=Han}/u.test(r.src) && !(isFlat?.(r.box) ?? false) && chars <= 12 && r.lines.length <= 2 || tilted && chars <= 12) r.kind = "sfx";
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
		if (b[0] === 66 && b[1] === 77) return "image/bmp";
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
	var RUBY_RATIO = .5;
	var RUBY_GAP = .55;
	function lineStarts(text, lines) {
		const out = [];
		let cur = 0;
		for (const l of lines) {
			const i = l ? text.indexOf(l, cur) : -1;
			if (i < 0) {
				out.push(cur);
				continue;
			}
			out.push(i);
			cur = i + l.length;
		}
		return out;
	}
	function assignMarks(text, lines, marks) {
		const st = lineStarts(text, lines);
		const used = new Set();
		return lines.map((l, i) => {
			const on = marks.filter((m) => !used.has(m) && l.length > 0 && m.start < st[i] + l.length && m.end > st[i]);
			on.forEach((m) => used.add(m));
			return on;
		});
	}
	function blockHeight(text, lines, px, lh, marks) {
		if (!marks?.length) return lines.length * px * lh;
		return assignMarks(text, lines, marks).reduce((acc, on) => acc + px * lh + (on.length ? px * RUBY_GAP : 0), 0);
	}
	function fitText(ctx, text, w, h, opts, maxPx = opts.maxFontPx, floorPx = 0, marks) {
		const lh = opts.lineHeight ?? 1.18;
		const weight = opts.bold ? "700" : "500";
		const fits = (px, mode, lax = false) => {
			ctx.font = `${weight} ${px}px ${opts.font}`;
			const wr = wrapText(ctx, text, w, mode);
			if (mode === "words" && wr.forcedBreaks > 0) return null;
			if (mode === "chars" && !lax && wr.doubleSplits > 0) return null;
			if (blockHeight(text, wr.lines, px, lh, marks) > h) return null;
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
	function enforceFloor(ctx, text, w, h, opts, layout, floorPx, marks) {
		if (layout.fontPx >= floorPx) return layout;
		const lh = opts.lineHeight ?? 1.18;
		const weight = opts.bold ? "700" : "500";
		const maxOverflow = opts.maxOverflow ?? 1.6;
		ctx.font = `${weight} ${floorPx}px ${opts.font}`;
		let pick = null;
		let pickCost = Infinity;
		for (let f = 1; f <= maxOverflow + 1e-6; f += .15) {
			const wr = wrapText(ctx, text, w * f, "chars");
			const need = blockHeight(text, wr.lines, floorPx, lh, marks);
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
		const ls = (region.lines ?? []).filter((l) => l.words?.length || region.lines.length >= 2);
		if (ls.length) {
			const sizes = ls.map((l) => region.vertical ? l.box.w : l.box.h).sort((a, b) => a - b);
			return sizes[sizes.length >> 1];
		}
		const chars = Math.max(1, region.src.replace(/\s/g, "").length);
		const area = region.box.w * region.box.h;
		return Math.sqrt(area / chars) * 1.05;
	}
	function planRegion(ctx, region, opts, capPx) {
		const text = region.dst?.trim();
		if (!text) return null;
		const lead = region.dst.length - region.dst.trimStart().length;
		const marks = (region.rubyMarks ?? []).map((m) => ({
			text: m.text,
			start: Math.max(0, m.start - lead),
			end: Math.min(text.length, m.end - lead)
		})).filter((m) => m.end > m.start && m.text);
		const lay = region.layout ?? region.box;
		const padX = Math.max(2, lay.w * .04);
		const padY = Math.max(2, lay.h * .04);
		const w = Math.max(8, lay.w - padX * 2);
		const h = Math.max(8, lay.h - padY * 2);
		const sourceCap = Math.max(opts.minFontPx + 2, Math.min(opts.maxFontPx, sourceGlyphPx(region) * (region.vertical ? 1.05 : 1.3)));
		const cap = capPx !== void 0 ? Math.max(opts.minFontPx, Math.min(capPx, sourceCap)) : sourceCap;
		const pageW = ctx.canvas?.width ?? 0;
		const floorPx = Math.floor(Math.min(cap, Math.max(opts.minFontPx, pageW * (opts.floorRatio ?? .015))));
		const layout = enforceFloor(ctx, text, w, h, opts, fitText(ctx, text, w, h, opts, cap, floorPx, marks), floorPx, marks);
		const bg = region.bg ?? [
			255,
			255,
			255
		];
		return {
			region,
			text,
			marks,
			lay,
			padX,
			padY,
			w,
			h,
			layout,
			bg,
			dark: luma(bg) < 128
		};
	}
	function drawPlan(ctx, plan, opts) {
		const { region, text, marks, lay, padX, padY, layout, bg, dark } = plan;
		const pageW = ctx.canvas?.width ?? 0;
		const pageH = ctx.canvas?.height ?? 0;
		const fill = dark ? "#ffffff" : "#111111";
		const stroke = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
		ctx.save();
		const weight = opts.bold ? "700" : "500";
		const mainFont = `${weight} ${layout.fontPx}px ${opts.font}`;
		ctx.font = mainFont;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const total = blockHeight(text, layout.lines, layout.fontPx, layout.lineHeight, marks);
		const starts = lineStarts(text, layout.lines);
		const perLine = assignMarks(text, layout.lines, marks);
		const widest = Math.max(...layout.lines.map((l) => ctx.measureText(l).width));
		const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
		let cx = clamp(region.box.x + region.box.w / 2, lay.x + padX + widest / 2, lay.x + lay.w - padX - widest / 2);
		let cy = clamp(region.box.y + region.box.h / 2, lay.y + padY + total / 2, lay.y + lay.h - padY - total / 2);
		if (layout.overflow && pageW && pageH) {
			const m = layout.fontPx * .5;
			cx = Math.min(Math.max(cx, widest / 2 + m), pageW - widest / 2 - m);
			cy = Math.min(Math.max(cy, total / 2 + m), pageH - total / 2 - m);
		}
		let y = cy - total / 2;
		const overArt = region.flat === false && region.kind !== "bubble";
		const needStroke = !region.flat || region.kind === "sfx" || !!layout.overflow;
		if (overArt || layout.overflow) {
			ctx.fillStyle = overArt ? dark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.78)" : `rgba(${bg[0]},${bg[1]},${bg[2]},0.92)`;
			const bw = widest + layout.fontPx * .8;
			const bh = total + layout.fontPx * .4;
			roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, layout.fontPx * .5);
			ctx.fill();
		}
		const paint = (s, x, yy, px) => {
			if (needStroke) {
				ctx.lineJoin = "round";
				ctx.lineWidth = Math.max(1.5, px * .18);
				ctx.strokeStyle = dark ? "rgba(0,0,0,0.9)" : stroke;
				ctx.strokeText(s, x, yy);
			}
			ctx.fillStyle = fill;
			ctx.fillText(s, x, yy);
		};
		layout.lines.forEach((line, i) => {
			const onLine = perLine[i];
			if (onLine.length) y += layout.fontPx * RUBY_GAP;
			const mid = y + layout.fontPx * layout.lineHeight / 2;
			ctx.font = mainFont;
			paint(line, cx, mid, layout.fontPx);
			if (onLine.length) {
				const lineW = ctx.measureText(line).width;
				const left = cx - lineW / 2;
				for (const m of onLine) {
					const a = Math.max(0, m.start - starts[i]);
					const b = Math.min(line.length, m.end - starts[i]);
					ctx.font = mainFont;
					const x0 = left + ctx.measureText(line.slice(0, a)).width;
					const x1 = left + ctx.measureText(line.slice(0, b)).width;
					let rpx = Math.max(7, Math.round(layout.fontPx * RUBY_RATIO));
					ctx.font = `${weight} ${rpx}px ${opts.font}`;
					if (ctx.measureText(m.text).width > x1 - x0 + layout.fontPx) {
						rpx = Math.max(7, Math.round(layout.fontPx * .38));
						ctx.font = `${weight} ${rpx}px ${opts.font}`;
					}
					paint(m.text, (x0 + x1) / 2, mid - layout.fontPx * .5 - rpx * .4, rpx);
				}
			}
			y += layout.fontPx * layout.lineHeight;
		});
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
		const prompt = `You are a manga OCR + translation engine. Find EVERY text block in this comic page written in ${name(ctx.sourceLang)}: speech bubbles, thought bubbles, captions/narration boxes` + (opts.includeSfx ? ", and sound effects" : ". Ignore sound effects drawn as art (onomatopoeia) and ignore watermarks/page numbers") + `.\nFor each block return box_2d as [ymin, xmin, ymax, xmax] normalised to 0-1000 covering the whole text tightly, kind, vertical (true when the original text runs top-to-bottom), src (the original text, lines joined with a space) and dst (a natural ${name(ctx.targetLang)} translation that fits a speech bubble: concise, colloquial, matching the speaker's tone).\nRuby (furigana) beside a word: ignore hiragana readings. When the ruby is katakana or kanji, append its translation in ⟨ ⟩ right after the translated word in dst (相棒 with ruby パートナー → 파트너⟨파트너⟩); when the ruby is in Latin or another foreign script, append it verbatim in ⟨ ⟩.\nOrder blocks in reading order (${ctx.sourceLang === "ja" ? "right-to-left, top-to-bottom" : "left-to-right, top-to-bottom"}). Return an empty array if there is no text.` + glossaryBlock(ctx) + historyBlock(ctx);
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
				parts: [{ text: `Translate the following manga speech-bubble texts from ${name(ctx.sourceLang)} to ${name(ctx.targetLang)}. They come from one page in reading order; use the surrounding lines as context. Keep each translation concise and colloquial so it fits a bubble. Some words are wrapped in 〔 〕 (they carry ruby text); keep the corresponding words of the translation wrapped in 〔 〕 too. Return a JSON array of exactly ${texts.length} strings in the same order (empty string if an item is not translatable text).` + glossaryBlock(ctx) + historyBlock(ctx) + `\nTexts:\n${JSON.stringify(texts)}` }]
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
				const words = l.words.filter((w) => w.box).map((w) => ({
					text: w.text,
					box: normBoxToPixels(w.box, img.width, img.height, img.scale)
				}));
				out.push({
					box: normBoxToPixels(nb, img.width, img.height, img.scale),
					text: cleanLensText(l.text),
					angle: rot,
					vertical,
					group: gi,
					words: words.length === l.words.length ? words : void 0
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
	var breathe = () => new Promise((r) => setTimeout(r, 0));
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
				if (s.stages.ruby !== "off") regions.forEach(parseInlineRuby);
				else regions.forEach((r) => r.dst = r.dst.replace(/⟨[^⟨⟩]*⟩/g, ""));
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
			regions = sortReadingOrder(filterRegions(splitOverlapping(mergeLines(handleFurigana(ocr.lines, s.stages.ruby === "off" ? "off" : "on"), { gapClear }), gapClear), img.width, img.height), ctx.sourceLang === "ja");
			tagSfx(regions, (box) => ringIsFlat(rasterData, box));
			if (!s.stages.sfx) regions = regions.filter((r) => r.kind !== "sfx");
			t0 = performance.now();
			if (regions.length) {
				const rubyKeys = rubyTextsToTranslate(regions);
				const tr = await runTranslate([...regions.map((r) => r.src), ...rubyKeys], ctx, s, signal, log);
				const rubyTr = new Map(rubyKeys.map((k, i) => [k, tr.dst[regions.length + i] ?? ""]));
				regions.forEach((r, i) => applyRuby(r, tr.dst[i] ?? "", rubyTr));
				provider = `${ocr.provider}+${tr.provider}`;
			} else provider = ocr.provider;
			mark("translate", t0);
		}
		regions = regions.filter((r) => r.src && r.dst && r.dst.trim() !== r.src.trim());
		t0 = performance.now();
		if (regions.length) {
			for (const r of regions) {
				r.layout = estimateLayoutRect(rasterData, r, eraseRegion(rasterData, r, { mode: s.stages.erase }));
				if (input.cooperative) await breathe();
			}
			resolveLayoutOverlaps(regions);
			c2d.putImageData(id, 0, 0);
			mark("erase", t0);
			t0 = performance.now();
			let plans = regions.map((r) => planRegion(c2d, r, s.render));
			if (s.render.unifyFont) {
				const sizes = plans.filter((p) => !!p).map((p) => p.layout.fontPx).sort((a, b) => a - b);
				const base = sizes.length ? sizes[sizes.length >> 1] : 0;
				if (base) plans = plans.map((p) => p && p.layout.fontPx > base ? planRegion(c2d, p.region, s.render, base) : p);
			}
			for (const p of plans) {
				if (!p) continue;
				const lay = drawPlan(c2d, p, s.render);
				p.region.fontPx = lay.fontPx;
				p.region.lineCount = lay.lines.length;
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
			sfx: false,
			ruby: "on"
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
			floorRatio: .015,
			unifyFont: false
		},
		debug: false
	};
	var KEY = "miri.settings.v1";
	var HOST_KEY = "miri.hosts.v1";
	function currentHost() {
		try {
			return location.hostname || "";
		} catch {
			return "";
		}
	}
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
		let merged;
		if (!raw) merged = structuredClone(DEFAULT_SETTINGS);
		else try {
			merged = deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
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
			if (merged.stages.ruby !== "off") merged.stages.ruby = "on";
		} catch {
			merged = structuredClone(DEFAULT_SETTINGS);
		}
		const host = currentHost();
		if (host) {
			const p = (await gmGet(HOST_KEY, {}))[host];
			if (p?.sourceLang) merged.sourceLang = p.sourceLang;
			if (p?.targetLang) merged.targetLang = p.targetLang;
		}
		return merged;
	}
	async function saveSettings(s) {
		await gmSet(KEY, JSON.stringify(s));
		const host = currentHost();
		if (host) {
			const prefs = await gmGet(HOST_KEY, {});
			prefs[host] = {
				sourceLang: s.sourceLang,
				targetLang: s.targetLang
			};
			await gmSet(HOST_KEY, prefs);
		}
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
			`r${s.stages.ruby}`,
			`f${s.render.floorRatio}${s.render.bold ? "b" : ""}${s.render.unifyFont ? "u" : ""}`
		].join("|");
	}
	var jsContent = "(function() {\n	//#region src/core/gm.ts\n	const g = globalThis;\n	typeof g.GM_xmlhttpRequest === \"function\" || typeof g.GM !== \"undefined\" && g.GM?.xmlHttpRequest, typeof g.GM_getValue === \"function\" || typeof g.GM !== \"undefined\" && g.GM?.getValue, g.GM_registerMenuCommand;\n	let transport = null;\n	/** Route all requests through a custom transport (the pipeline worker proxies them to the page thread). */\n	function setTransport(t) {\n		transport = t;\n	}\n	/** Cross-origin HTTP via GM_xmlhttpRequest (bypasses CORS / lets us set Referer). Falls back to fetch. */\n	function gmRequest(req) {\n		if (transport) return transport(req);\n		const xhr = g.GM_xmlhttpRequest ?? g.GM?.xmlHttpRequest;\n		if (typeof xhr === \"function\") return new Promise((resolve, reject) => {\n			let body = req.body;\n			if (body instanceof Uint8Array) body = new Blob([body]);\n			if (body instanceof ArrayBuffer) body = new Blob([body]);\n			const handle = xhr({\n				url: req.url,\n				method: req.method ?? \"GET\",\n				headers: req.headers,\n				data: body,\n				responseType: \"arraybuffer\",\n				timeout: req.timeoutMs ?? 6e4,\n				anonymous: req.anonymous ?? true,\n				onload: (r) => resolve({\n					status: r.status,\n					statusText: r.statusText,\n					headers: r.responseHeaders ?? \"\",\n					body: r.response,\n					finalUrl: r.finalUrl ?? req.url\n				}),\n				onerror: (e) => reject(/* @__PURE__ */ new Error(`network error: ${e?.error ?? e?.statusText ?? \"unknown\"}`)),\n				ontimeout: () => reject(/* @__PURE__ */ new Error(\"timeout\")),\n				onabort: () => reject(new DOMException(\"aborted\", \"AbortError\"))\n			});\n			req.signal?.addEventListener(\"abort\", () => handle?.abort?.());\n		});\n		return fetch(req.url, {\n			method: req.method ?? \"GET\",\n			headers: req.headers,\n			body: req.body,\n			credentials: req.anonymous === false ? \"include\" : \"omit\",\n			signal: req.signal\n		}).then(async (r) => ({\n			status: r.status,\n			statusText: r.statusText,\n			headers: [...r.headers.entries()].map(([k, v]) => `${k}: ${v}`).join(\"\\n\"),\n			body: await r.arrayBuffer(),\n			finalUrl: r.url\n		}));\n	}\n	//#endregion\n	//#region src/core/erase.ts\n	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));\n	const luma$1 = (r, g, b) => .299 * r + .587 * g + .114 * b;\n	function clipBox(b, W, H) {\n		const x = clamp(Math.floor(b.x), 0, W - 1);\n		const y = clamp(Math.floor(b.y), 0, H - 1);\n		const x2 = clamp(Math.ceil(b.x + b.w), x + 1, W);\n		const y2 = clamp(Math.ceil(b.y + b.h), y + 1, H);\n		return {\n			x,\n			y,\n			w: x2 - x,\n			h: y2 - y\n		};\n	}\n	function padBox(b, px, py = px) {\n		return {\n			x: b.x - px,\n			y: b.y - py,\n			w: b.w + 2 * px,\n			h: b.h + 2 * py\n		};\n	}\n	function median(arr) {\n		if (!arr.length) return 0;\n		const a = arr.slice().sort((p, q) => p - q);\n		return a[a.length >> 1];\n	}\n	/** Background colour and flatness from the ring between `inner` and `outer`. */\n	function sampleRing(img, inner, outer) {\n		const rs = [];\n		const gs = [];\n		const bs = [];\n		const { data, width } = img;\n		const step = Math.max(1, Math.floor(Math.sqrt((outer.w * outer.h - inner.w * inner.h) / 4e3)));\n		for (let y = outer.y; y < outer.y + outer.h; y += step) for (let x = outer.x; x < outer.x + outer.w; x += step) {\n			if (x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h) continue;\n			const i = (y * width + x) * 4;\n			rs.push(data[i]);\n			gs.push(data[i + 1]);\n			bs.push(data[i + 2]);\n		}\n		if (!rs.length) return {\n			bg: [\n				255,\n				255,\n				255\n			],\n			spread: 0,\n			count: 0\n		};\n		const bg = [\n			median(rs),\n			median(gs),\n			median(bs)\n		];\n		const bl = luma$1(bg[0], bg[1], bg[2]);\n		let dev = 0;\n		for (let i = 0; i < rs.length; i++) dev += Math.abs(luma$1(rs[i], gs[i], bs[i]) - bl);\n		return {\n			bg,\n			spread: dev / rs.length,\n			count: rs.length\n		};\n	}\n	/** Otsu threshold over a luma histogram. */\n	function otsu(hist, total) {\n		let sum = 0;\n		for (let t = 0; t < 256; t++) sum += t * hist[t];\n		let sumB = 0;\n		let wB = 0;\n		let max = -1;\n		let thr = 127;\n		for (let t = 0; t < 256; t++) {\n			wB += hist[t];\n			if (wB === 0) continue;\n			const wF = total - wB;\n			if (wF === 0) break;\n			sumB += t * hist[t];\n			const mB = sumB / wB;\n			const mF = (sum - sumB) / wF;\n			const between = wB * wF * (mB - mF) * (mB - mF);\n			if (between > max) {\n				max = between;\n				thr = t;\n			}\n		}\n		return thr;\n	}\n	/** Build the ink mask of `rect`: 1 = text pixel. Removes components that look like bubble borders / art. */\n	function inkMask(img, rect, bg) {\n		const { data, width } = img;\n		const n = rect.w * rect.h;\n		const L = new Float32Array(n);\n		const hist = /* @__PURE__ */ new Uint32Array(256);\n		for (let yy = 0; yy < rect.h; yy++) for (let xx = 0; xx < rect.w; xx++) {\n			const i = ((rect.y + yy) * width + rect.x + xx) * 4;\n			const l = luma$1(data[i], data[i + 1], data[i + 2]);\n			L[yy * rect.w + xx] = l;\n			hist[l | 0]++;\n		}\n		const thr = otsu(hist, n);\n		const bgL = luma$1(bg[0], bg[1], bg[2]);\n		const inkDark = bgL >= thr;\n		const mask = new Uint8Array(n);\n		let count = 0;\n		for (let i = 0; i < n; i++) {\n			const l = L[i];\n			if ((inkDark ? l < thr : l > thr) && Math.abs(l - bgL) > 24) {\n				mask[i] = 1;\n				count++;\n			}\n		}\n		if (!count) return {\n			mask,\n			count\n		};\n		const label = new Int32Array(n).fill(-1);\n		const stack = [];\n		let removed = 0;\n		for (let s = 0; s < n; s++) {\n			if (!mask[s] || label[s] !== -1) continue;\n			let minx = rect.w, maxx = -1, miny = rect.h, maxy = -1, touches = false, size = 0;\n			const members = [];\n			stack.push(s);\n			label[s] = s;\n			while (stack.length) {\n				const p = stack.pop();\n				members.push(p);\n				size++;\n				const px = p % rect.w;\n				const py = p / rect.w | 0;\n				if (px < minx) minx = px;\n				if (px > maxx) maxx = px;\n				if (py < miny) miny = py;\n				if (py > maxy) maxy = py;\n				if (px === 0 || py === 0 || px === rect.w - 1 || py === rect.h - 1) touches = true;\n				const nb = [\n					p - 1,\n					p + 1,\n					p - rect.w,\n					p + rect.w\n				];\n				if (px === 0) nb[0] = -1;\n				if (px === rect.w - 1) nb[1] = -1;\n				for (const q of nb) if (q >= 0 && q < n && mask[q] && label[q] === -1) {\n					label[q] = s;\n					stack.push(q);\n				}\n			}\n			const spanW = (maxx - minx + 1) / rect.w;\n			const spanH = (maxy - miny + 1) / rect.h;\n			const fill = size / ((maxx - minx + 1) * (maxy - miny + 1));\n			if (touches && (spanW > .9 || spanH > .9) && fill < .35) {\n				for (const m of members) mask[m] = 0;\n				removed += size;\n			}\n		}\n		return {\n			mask,\n			count: count - removed\n		};\n	}\n	function dilate(mask, w, h, r) {\n		let cur = mask;\n		for (let k = 0; k < r; k++) {\n			const next = new Uint8Array(cur.length);\n			for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {\n				const i = y * w + x;\n				if (cur[i] || x > 0 && cur[i - 1] || x < w - 1 && cur[i + 1] || y > 0 && cur[i - w] || y < h - 1 && cur[i + w]) next[i] = 1;\n			}\n			cur = next;\n		}\n		return cur;\n	}\n	/** Laplace (diffusion) fill of masked pixels from their surroundings. Good enough for text-sized holes. */\n	function diffuseFill(img, rect, mask, bg, iterations) {\n		const { data, width } = img;\n		const w = rect.w;\n		const h = rect.h;\n		const n = w * h;\n		const buf = new Float32Array(n * 3);\n		const idxs = [];\n		for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {\n			const p = yy * w + xx;\n			const i = ((rect.y + yy) * width + rect.x + xx) * 4;\n			if (mask[p]) {\n				buf[p * 3] = bg[0];\n				buf[p * 3 + 1] = bg[1];\n				buf[p * 3 + 2] = bg[2];\n				idxs.push(p);\n			} else {\n				buf[p * 3] = data[i];\n				buf[p * 3 + 1] = data[i + 1];\n				buf[p * 3 + 2] = data[i + 2];\n			}\n		}\n		for (let it = 0; it < iterations; it++) for (const p of idxs) {\n			const x = p % w;\n			const y = p / w | 0;\n			let r = 0, g = 0, b = 0, c = 0;\n			if (x > 0) {\n				r += buf[(p - 1) * 3];\n				g += buf[(p - 1) * 3 + 1];\n				b += buf[(p - 1) * 3 + 2];\n				c++;\n			}\n			if (x < w - 1) {\n				r += buf[(p + 1) * 3];\n				g += buf[(p + 1) * 3 + 1];\n				b += buf[(p + 1) * 3 + 2];\n				c++;\n			}\n			if (y > 0) {\n				r += buf[(p - w) * 3];\n				g += buf[(p - w) * 3 + 1];\n				b += buf[(p - w) * 3 + 2];\n				c++;\n			}\n			if (y < h - 1) {\n				r += buf[(p + w) * 3];\n				g += buf[(p + w) * 3 + 1];\n				b += buf[(p + w) * 3 + 2];\n				c++;\n			}\n			if (c) {\n				buf[p * 3] = r / c;\n				buf[p * 3 + 1] = g / c;\n				buf[p * 3 + 2] = b / c;\n			}\n		}\n		for (const p of idxs) {\n			const xx = p % w;\n			const yy = p / w | 0;\n			const i = ((rect.y + yy) * width + rect.x + xx) * 4;\n			data[i] = buf[p * 3];\n			data[i + 1] = buf[p * 3 + 1];\n			data[i + 2] = buf[p * 3 + 2];\n		}\n	}\n	/** Erase the text of one region in place. */\n	/** Is the ring just outside `box` flat (bubble / gutter / caption box) — same test eraseRegion uses. */\n	function ringIsFlat(img, box, flatThreshold = 14) {\n		const glyph = Math.max(6, Math.min(box.w, box.h));\n		const rect = clipBox(padBox(box, clamp(Math.round(glyph * .12), 2, 12)), img.width, img.height);\n		return sampleRing(img, rect, clipBox(padBox(rect, clamp(Math.round(glyph * .1), 3, 10)), img.width, img.height)).spread < flatThreshold;\n	}\n	function eraseRegion(img, region, opts) {\n		const W = img.width;\n		const H = img.height;\n		const glyph = Math.max(6, Math.min(region.box.w, region.box.h));\n		const pad = clamp(Math.round(glyph * .12), 2, 12);\n		const rect = clipBox(padBox(region.box, pad), W, H);\n		const ring = sampleRing(img, rect, clipBox(padBox(rect, clamp(Math.round(glyph * .1), 3, 10)), W, H));\n		const flat = ring.spread < (opts.flatThreshold ?? 14);\n		const info = {\n			bg: ring.bg,\n			flat,\n			spread: ring.spread,\n			inkPixels: 0,\n			rect\n		};\n		region.bg = ring.bg;\n		region.flat = flat;\n		if (opts.mode === \"overlay\") return info;\n		const { mask, count } = inkMask(img, rect, ring.bg);\n		info.inkPixels = count;\n		if (!count) return info;\n		const grow = clamp(Math.round(glyph * .06), 1, 3);\n		const m = dilate(mask, rect.w, rect.h, grow);\n		if (flat || opts.mode === \"flat-fill\") {\n			const { data } = img;\n			for (let yy = 0; yy < rect.h; yy++) for (let xx = 0; xx < rect.w; xx++) {\n				if (!m[yy * rect.w + xx]) continue;\n				const i = ((rect.y + yy) * W + rect.x + xx) * 4;\n				data[i] = ring.bg[0];\n				data[i + 1] = ring.bg[1];\n				data[i + 2] = ring.bg[2];\n			}\n		} else diffuseFill(img, rect, dilate(m, rect.w, rect.h, 1), ring.bg, clamp(Math.round(Math.max(rect.w, rect.h) / 2), 24, 90));\n		return info;\n	}\n	/**\n	* Estimate the area available for typesetting: grow the (already erased) box\n	* outwards one pixel row/column at a time while the new strip is still\n	* background colour. Stops at bubble borders, art, or the caps. Text on art\n	* (non-flat ring) stops immediately, so the original box is kept.\n	*/\n	function estimateLayoutRect(img, region, info) {\n		const W = img.width;\n		const H = img.height;\n		const { data } = img;\n		const bgL = luma$1(info.bg[0], info.bg[1], info.bg[2]);\n		const tol = info.flat ? 40 : 24;\n		const maxBad = .03;\n		const isBg = (x, y) => {\n			const i = (y * W + x) * 4;\n			return Math.abs(luma$1(data[i], data[i + 1], data[i + 2]) - bgL) <= tol;\n		};\n		const colOk = (x, y0, y1) => {\n			let bad = 0;\n			const allowed = Math.max(1, Math.floor((y1 - y0) * maxBad));\n			for (let y = y0; y < y1; y++) if (!isBg(x, y) && ++bad > allowed) return false;\n			return true;\n		};\n		const rowOk = (y, x0, x1) => {\n			let bad = 0;\n			const allowed = Math.max(1, Math.floor((x1 - x0) * maxBad));\n			for (let x = x0; x < x1; x++) if (!isBg(x, y) && ++bad > allowed) return false;\n			return true;\n		};\n		const box = region.box;\n		const start = clipBox(padBox(box, 1), W, H);\n		const capX = Math.round(Math.max(box.w, box.h) * 1.6) + 8;\n		const capY = Math.round(Math.max(box.h, box.w * .6) * 1) + 8;\n		/** Grow a rectangle until a side hits something that is not background. 'round' grows all sides in turn,\n		*  'hfirst' uses up the horizontal room before growing vertically (finds wide bands inside round bubbles). */\n		const grow = (s0, order) => {\n			let { x, y, w, h } = s0;\n			let l = 0, r = 0, t = 0, b = 0;\n			const stepH = () => {\n				let g = false;\n				if (l < capX && x > 0 && colOk(x - 1, y, y + h)) {\n					x--;\n					w++;\n					l++;\n					g = true;\n				}\n				if (r < capX && x + w < W && colOk(x + w, y, y + h)) {\n					w++;\n					r++;\n					g = true;\n				}\n				return g;\n			};\n			const stepV = () => {\n				let g = false;\n				if (t < capY && y > 0 && rowOk(y - 1, x, x + w)) {\n					y--;\n					h++;\n					t++;\n					g = true;\n				}\n				if (b < capY && y + h < H && rowOk(y + h, x, x + w)) {\n					h++;\n					b++;\n					g = true;\n				}\n				return g;\n			};\n			if (order === \"round\") {\n				let grew = true;\n				while (grew) {\n					const gh = stepH();\n					const gv = stepV();\n					grew = gh || gv;\n				}\n			} else {\n				while (stepH());\n				while (stepV());\n			}\n			return {\n				x,\n				y,\n				w,\n				h,\n				l,\n				r,\n				t,\n				b\n			};\n		};\n		const first = grow(start, \"round\");\n		if (!info.flat && first.l + first.r + first.t + first.b < 4) return box;\n		const cands = [first, grow(start, \"hfirst\")];\n		for (const f of [.75, .5]) {\n			if (start.h * f < 24) break;\n			const bh = Math.round(start.h * f);\n			cands.push(grow({\n				x: start.x,\n				y: start.y + (start.h - bh >> 1),\n				w: start.w,\n				h: bh\n			}, \"hfirst\"));\n		}\n		const trim = (g, keepBox) => {\n			const m = clamp(Math.round(Math.min(g.w, g.h) * .08), 2, 14);\n			let nx = g.x + Math.min(m, g.l);\n			let ny = g.y + Math.min(m, g.t);\n			let nx2 = g.x + g.w - Math.min(m, g.r);\n			let ny2 = g.y + g.h - Math.min(m, g.b);\n			if (keepBox) {\n				nx = Math.min(box.x, nx);\n				ny = Math.min(box.y, ny);\n				nx2 = Math.max(box.x + box.w, nx2);\n				ny2 = Math.max(box.y + box.h, ny2);\n			}\n			return clipBox({\n				x: nx,\n				y: ny,\n				w: nx2 - nx,\n				h: ny2 - ny\n			}, W, H);\n		};\n		let best = trim(first, true);\n		for (let i = 1; i < cands.length; i++) {\n			const c = trim(cands[i], false);\n			if (c.w * c.h > best.w * best.h * 1.05 && c.h >= Math.min(box.h, 2 * Math.max(10, Math.min(box.w, box.h)))) best = c;\n		}\n		return best;\n	}\n	function boxesIntersect(a, b) {\n		return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;\n	}\n	/** Largest sub-rectangle of `rect` that does not overlap `obstacle` and still contains `must` (falls back to `must`). */\n	function cutRect(rect, obstacle, must) {\n		const cands = [\n			{\n				x: rect.x,\n				y: rect.y,\n				w: rect.w,\n				h: obstacle.y - rect.y\n			},\n			{\n				x: rect.x,\n				y: obstacle.y + obstacle.h,\n				w: rect.w,\n				h: rect.y + rect.h - (obstacle.y + obstacle.h)\n			},\n			{\n				x: rect.x,\n				y: rect.y,\n				w: obstacle.x - rect.x,\n				h: rect.h\n			},\n			{\n				x: obstacle.x + obstacle.w,\n				y: rect.y,\n				w: rect.x + rect.w - (obstacle.x + obstacle.w),\n				h: rect.h\n			}\n		];\n		let best = null;\n		for (const c of cands) {\n			if (c.w <= 0 || c.h <= 0) continue;\n			if (!(c.x <= must.x && c.y <= must.y && c.x + c.w >= must.x + must.w && c.y + c.h >= must.y + must.h)) continue;\n			if (!best || c.w * c.h > best.w * best.h) best = c;\n		}\n		return best ?? { ...must };\n	}\n	/**\n	* Make layout rectangles mutually exclusive so two regions never typeset over the same area:\n	* a layout may not cover another region's text box, and later regions (reading order) yield to earlier ones.\n	*/\n	function resolveLayoutOverlaps(regions) {\n		const mustOf = (r) => {\n			const l = r.layout;\n			const x = Math.max(l.x, r.box.x);\n			const y = Math.max(l.y, r.box.y);\n			const x2 = Math.min(l.x + l.w, r.box.x + r.box.w);\n			const y2 = Math.min(l.y + l.h, r.box.y + r.box.h);\n			return x2 > x && y2 > y ? {\n				x,\n				y,\n				w: x2 - x,\n				h: y2 - y\n			} : r.box;\n		};\n		for (let i = 0; i < regions.length; i++) {\n			const a = regions[i];\n			if (!a.layout) continue;\n			for (let j = 0; j < regions.length; j++) {\n				if (i === j) continue;\n				const b = regions[j];\n				if (boxesIntersect(a.layout, b.box)) a.layout = cutRect(a.layout, b.box, mustOf(a));\n				if (j < i && b.layout && boxesIntersect(a.layout, b.layout)) a.layout = cutRect(a.layout, b.layout, mustOf(a));\n			}\n			if (a.layout.w * a.layout.h < a.box.w * a.box.h * .6) a.layout = { ...a.box };\n		}\n	}\n	/**\n	* True when the band between two text lines looks like plain bubble interior: almost every pixel is\n	* close to the band's own median luma. A bubble border, panel edge or artwork crossing the band\n	* leaves a streak of pixels that differ strongly from that median.\n	*/\n	function bandIsClear(img, band, maxOutlierFrac = .035) {\n		const b = clipBox(band, img.width, img.height);\n		if (b.w < 1 || b.h < 1) return true;\n		const n = b.w * b.h;\n		const lum = new Uint8Array(n);\n		let k = 0;\n		for (let y = b.y; y < b.y + b.h; y++) {\n			let o = (y * img.width + b.x) * 4;\n			for (let x = 0; x < b.w; x++, o += 4) lum[k++] = img.data[o] * 77 + img.data[o + 1] * 151 + img.data[o + 2] * 28 >> 8;\n		}\n		const hist = /* @__PURE__ */ new Uint32Array(256);\n		for (let i = 0; i < n; i++) hist[lum[i]]++;\n		let acc = 0;\n		let med = 0;\n		for (; med < 256; med++) {\n			acc += hist[med];\n			if (acc * 2 >= n) break;\n		}\n		let outliers = 0;\n		for (let i = 0; i < n; i++) if (Math.abs(lum[i] - med) > 60) outliers++;\n		return outliers <= Math.max(2, n * maxOutlierFrac);\n	}\n	/** brackets as they come back from the translator (Papago turns 〔〕 into ASCII [ ]) */\n	const RUBY_MARK_RE = /[〔［[]([^〔〕［］[\\]]*)[〕］\\]]/g;\n	/** inline ruby in a one-shot (Gemini) translation: 단어⟨루비⟩ */\n	const INLINE_RUBY_RE = /(\\S+?)⟨([^⟨⟩]+)⟩/g;\n	const HIRAGANA_ONLY = /^[\\u3040-\\u309f\\u30fc\\u30fb\\s]+$/;\n	const KATAKANA_OR_KANJI = /[\\u30a1-\\u30fa\\u30fd\\u30fe\\u31f0-\\u31ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3005\\uf900-\\ufaff]/;\n	/** hiragana → ignore (reading aid); katakana / kanji → translate; anything else (Latin, digits, Cyrillic…) → as is */\n	function classifyRuby(text) {\n		const t = text.replace(/\\s+/g, \"\");\n		if (!t) return \"ignore\";\n		if (HIRAGANA_ONLY.test(t)) return \"ignore\";\n		if (KATAKANA_OR_KANJI.test(t)) return \"translate\";\n		return \"asis\";\n	}\n	const NOT_RUBY = /[。、．，！？!?※（）()「」『』【】\\[\\]…:：;；♪♡☆★]/;\n	/** Lines that may be ruby at all: a bare word — any hiragana string, or a short string in another script; never punctuation. */\n	function rubyCandidate(l) {\n		const t = l.text.replace(/\\s+/g, \"\");\n		if (!t || NOT_RUBY.test(t)) return false;\n		return HIRAGANA_ONLY.test(t) || t.length <= 16;\n	}\n	/** Index range [from, to] of the base words the ruby line spans (falls back to the nearest word). */\n	function rubyWordRange(base, ruby) {\n		const words = base.words;\n		if (!words?.length) return null;\n		const span = (b) => base.vertical ? [b.y, b.y + b.h] : [b.x, b.x + b.w];\n		const [r0, r1] = span(ruby.box);\n		let from = -1;\n		let to = -1;\n		words.forEach((w, i) => {\n			const [w0, w1] = span(w.box);\n			if (Math.min(r1, w1) - Math.max(r0, w0) < (w1 - w0) * .3) return;\n			if (from < 0) from = i;\n			to = i;\n		});\n		if (from < 0) {\n			const rc = (r0 + r1) / 2;\n			let best = 0;\n			let bestD = Infinity;\n			words.forEach((w, i) => {\n				const [w0, w1] = span(w.box);\n				const d = Math.abs((w0 + w1) / 2 - rc);\n				if (d < bestD) {\n					bestD = d;\n					best = i;\n				}\n			});\n			from = to = best;\n		}\n		return [from, to];\n	}\n	/** Rewrite the base line text with 〔 〕 around the annotated words and store the ruby notes in marker order. */\n	function markRubies(base, items) {\n		if (!items.length) return;\n		if (!base.words?.length) {\n			base.text = `〔${base.text}〕`;\n			base.rubies = [{\n				kind: items.some((i) => i.note.kind === \"translate\") ? \"translate\" : \"asis\",\n				text: items.map((i) => i.note.text).join(\" \")\n			}];\n			return;\n		}\n		const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);\n		const merged = [];\n		for (const it of sorted) {\n			const last = merged[merged.length - 1];\n			if (last && it.from <= last.to) {\n				last.to = Math.max(last.to, it.to);\n				last.notes.push(it.note);\n			} else merged.push({\n				from: it.from,\n				to: it.to,\n				notes: [it.note]\n			});\n		}\n		const parts = [];\n		const notes = [];\n		base.words.forEach((w, i) => {\n			const open = merged.find((m) => m.from === i);\n			const close = merged.find((m) => m.to === i);\n			let t = w.text;\n			if (open) t = \"〔\" + t;\n			if (close) {\n				t += \"〕\";\n				notes.push(close.notes.length === 1 ? close.notes[0] : {\n					kind: close.notes.some((n) => n.kind === \"translate\") ? \"translate\" : \"asis\",\n					text: close.notes.map((n) => n.text).join(\" \")\n				});\n			}\n			parts.push(t);\n		});\n		base.text = parts.join(\" \").replace(/\\s+([?!.,:;…）」』])/g, \"$1\").replace(/([（「『])\\s+/g, \"$1\").trim();\n		base.rubies = notes;\n	}\n	/** Ruby strings that need a translation of their own (unique, in page order). */\n	function rubyTextsToTranslate(regions) {\n		const out = [];\n		for (const r of regions) for (const n of r.rubies ?? []) if (n.kind === \"translate\" && !out.includes(n.text)) out.push(n.text);\n		return out;\n	}\n	/** Strip the 〔 〕 markers from a source text (for display / page history). */\n	function stripRubyMarks(src) {\n		return src.replace(RUBY_MARK_RE, \"$1\");\n	}\n	/**\n	* Take the translated text of a region, remove the bracket markers and turn them into ruby marks (character ranges\n	* of region.dst). When the translator did not preserve the markers the rubies are shown over the first word rather\n	* than lost.\n	*/\n	function applyRuby(region, dst, rubyTr) {\n		const notes = region.rubies ?? [];\n		const display = (n) => ((n.kind === \"translate\" ? rubyTr.get(n.text) : n.text) ?? n.text).replace(/[〔〕［］[\\]⟨⟩]/g, \"\").trim();\n		const groups = [...dst.matchAll(RUBY_MARK_RE)];\n		const marks = [];\n		let out = \"\";\n		let last = 0;\n		groups.forEach((m, i) => {\n			out += dst.slice(last, m.index);\n			const start = out.length;\n			out += m[1];\n			const end = out.length;\n			last = m.index + m[0].length;\n			if (groups.length === notes.length && end > start) {\n				const text = display(notes[i]);\n				if (text) marks.push({\n					text,\n					start,\n					end\n				});\n			}\n		});\n		out += dst.slice(last);\n		region.dst = out;\n		region.src = stripRubyMarks(region.src);\n		if (notes.length && groups.length !== notes.length) {\n			const texts = notes.map(display).filter(Boolean);\n			const first = out.match(/^\\s*\\S+/)?.[0] ?? out;\n			if (texts.length && first.trim()) marks.push({\n				text: texts.join(\" \"),\n				start: first.length - first.trimStart().length,\n				end: first.length\n			});\n		}\n		region.rubyMarks = marks.length ? marks : void 0;\n	}\n	/** One-shot translations carry ruby inline as 단어⟨루비⟩ → marks over the preceding word. */\n	function parseInlineRuby(region) {\n		const dst = region.dst;\n		if (!dst.includes(\"⟨\")) return;\n		const marks = [];\n		let out = \"\";\n		let last = 0;\n		for (const m of dst.matchAll(INLINE_RUBY_RE)) {\n			out += dst.slice(last, m.index);\n			const start = out.length;\n			out += m[1];\n			const end = out.length;\n			last = m.index + m[0].length;\n			const text = m[2].trim();\n			if (text) marks.push({\n				text,\n				start,\n				end\n			});\n		}\n		out += dst.slice(last);\n		region.dst = out.replace(/[⟨⟩]/g, \"\");\n		region.rubyMarks = marks.length ? marks : void 0;\n	}\n	//#endregion\n	//#region src/core/merge.ts\n	function union(a, b) {\n		const x = Math.min(a.x, b.x);\n		const y = Math.min(a.y, b.y);\n		return {\n			x,\n			y,\n			w: Math.max(a.x + a.w, b.x + b.w) - x,\n			h: Math.max(a.y + a.h, b.y + b.h) - y\n		};\n	}\n	const glyphSize = (l) => Math.min(l.box.w, l.box.h);\n	const CJK = /[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af]/;\n	/** Gap between two lines along their stacking axis (columns: x, rows: y) and their overlap along the other axis. */\n	function relation(a, b) {\n		const inset = Math.max(1, Math.round(.15 * Math.max(glyphSize(a), glyphSize(b))));\n		if (a.vertical) {\n			const left = a.box.x < b.box.x ? a.box : b.box;\n			const gap = (left === a.box ? b.box : a.box).x - (left.x + left.w);\n			const top = Math.max(a.box.y, b.box.y);\n			const bot = Math.min(a.box.y + a.box.h, b.box.y + b.box.h);\n			return {\n				gap,\n				overlap: bot - top,\n				band: {\n					x: left.x + left.w + inset,\n					y: top,\n					w: gap - 2 * inset,\n					h: bot - top\n				}\n			};\n		}\n		const upper = a.box.y < b.box.y ? a.box : b.box;\n		const gap = (upper === a.box ? b.box : a.box).y - (upper.y + upper.h);\n		const l = Math.max(a.box.x, b.box.x);\n		const r = Math.min(a.box.x + a.box.w, b.box.x + b.box.w);\n		return {\n			gap,\n			overlap: r - l,\n			band: {\n				x: l,\n				y: upper.y + upper.h + inset,\n				w: r - l,\n				h: gap - 2 * inset\n			}\n		};\n	}\n	/**\n	* Group lines into blocks (one block ≈ one bubble).\n	* Two lines join when they have the same orientation and similar glyph size, sit next to each other\n	* (gap ≤ gapFactor × glyph, overlapping along the writing direction) and nothing but background lies\n	* between them (`gapClear`, i.e. no bubble border). Lines sharing an OCR paragraph id join as well,\n	* unless a border runs between them (grid layouts that OCR lumps into one paragraph).\n	*/\n	function mergeLines(lines, opts = {}) {\n		const n = lines.length;\n		const parent = Array.from({ length: n }, (_, i) => i);\n		const find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);\n		const unite = (a, b) => parent[find(a)] = find(b);\n		const useGroups = opts.useGroups !== false;\n		const gapFactor = opts.gapFactor ?? 1;\n		const maxRatio = opts.maxRatio ?? 1.6;\n		const clear = (band) => !opts.gapClear || band.w < 3 || band.h < 3 || opts.gapClear(band);\n		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {\n			const a = lines[i];\n			const b = lines[j];\n			const sameGroup = useGroups && a.group !== void 0 && a.group === b.group;\n			if (!!a.vertical !== !!b.vertical) {\n				if (sameGroup) unite(i, j);\n				continue;\n			}\n			const ga = glyphSize(a);\n			const gb = glyphSize(b);\n			const g = Math.max(ga, gb);\n			const { gap, overlap, band } = relation(a, b);\n			if (sameGroup) {\n				if (overlap > 0 && gap > 2 && !clear(band)) continue;\n				unite(i, j);\n				continue;\n			}\n			if (Math.max(ga, gb) / Math.max(1, Math.min(ga, gb)) > maxRatio) continue;\n			if (gap > g * gapFactor) continue;\n			const minLen = a.vertical ? Math.min(a.box.h, b.box.h) : Math.min(a.box.w, b.box.w);\n			if (overlap < Math.min(minLen * .3, g)) continue;\n			if (gap > 2 && !clear(band)) continue;\n			unite(i, j);\n		}\n		const groups = /* @__PURE__ */ new Map();\n		lines.forEach((l, i) => {\n			const r = find(i);\n			if (!groups.has(r)) groups.set(r, []);\n			groups.get(r).push(l);\n		});\n		return Array.from(groups.values(), buildRegion);\n	}\n	function buildRegion(g) {\n		const vertical = g.filter((l) => l.vertical).length * 2 >= g.length;\n		g.sort((a, b) => vertical ? b.box.x + b.box.w / 2 - (a.box.x + a.box.w / 2) : a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));\n		let box = g.reduce((acc, l) => union(acc, l.box), g[0].box);\n		for (const l of g) for (const rb of l.rubyBoxes ?? []) box = union(box, rb);\n		const rubies = g.flatMap((l) => l.rubies ?? []);\n		return {\n			box,\n			lines: g,\n			src: joinLines(g.map((l) => l.text.trim()).filter(Boolean)),\n			dst: \"\",\n			kind: \"unknown\",\n			vertical,\n			...rubies.length ? { rubies } : {}\n		};\n	}\n	/**\n	* OCR paragraphs sometimes span several visually separate boxes laid out in a grid; the resulting\n	* bounding boxes then overlap other blocks and the typeset text collides. Whenever two blocks\n	* overlap, re-cluster the lines of the larger one with a tight proximity rule (ignoring paragraph ids).\n	*/\n	function splitOverlapping(regions, gapClear) {\n		const rs = regions.slice();\n		const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);\n		const inter = (a, b) => {\n			const x = Math.max(a.x, b.x);\n			const y = Math.max(a.y, b.y);\n			const r = Math.min(a.x + a.w, b.x + b.w);\n			const btm = Math.min(a.y + a.h, b.y + b.h);\n			return r > x && btm > y ? (r - x) * (btm - y) : 0;\n		};\n		for (let pass = 0; pass < 3; pass++) {\n			let changed = false;\n			outer: for (let i = 0; i < rs.length; i++) for (let j = 0; j < rs.length; j++) {\n				if (i === j || rs[i].lines.length < 2) continue;\n				if (inter(rs[i].box, rs[j].box) < .25 * Math.min(area(rs[i].box), area(rs[j].box))) continue;\n				if (rs[i].lines.length < rs[j].lines.length) continue;\n				const parts = mergeLines(rs[i].lines, {\n					gapFactor: .6,\n					useGroups: false,\n					maxRatio: 2.2,\n					gapClear\n				});\n				if (parts.length < 2) continue;\n				rs.splice(i, 1, ...parts);\n				changed = true;\n				break outer;\n			}\n			if (!changed) break;\n		}\n		return rs;\n	}\n	/** CJK lines concatenate directly; Latin lines join with spaces and hyphenated breaks are healed (\"WEEK-\" + \"END\" → \"WEEKEND\"). */\n	function joinLines(parts) {\n		let out = \"\";\n		for (const p of parts) {\n			if (!out) {\n				out = p;\n				continue;\n			}\n			const cjk = CJK.test(out.slice(-1)) || CJK.test(p[0]);\n			if (/[A-Za-z]-$/.test(out) && /^[a-z]/i.test(p)) out = out.slice(0, -1) + p;\n			else out += (cjk ? \"\" : \" \") + p;\n		}\n		return cleanCjk(out);\n	}\n	const JA_ZH = /[\\u3040-\\u30ff\\u3400-\\u9fff\\uff01-\\uff5e、。]/;\n	/** Remove the spaces OCR inserts between Japanese/Chinese \"words\" and strip quote brackets that confuse MT engines. */\n	function cleanCjk(t) {\n		if (!JA_ZH.test(t)) return t;\n		let out = \"\";\n		for (let i = 0; i < t.length; i++) {\n			const ch = t[i];\n			if (/\\s/.test(ch)) {\n				const prev = out[out.length - 1] ?? \"\";\n				const next = t.slice(i + 1).trimStart()[0] ?? \"\";\n				if (JA_ZH.test(prev) || JA_ZH.test(next) || /[!?！？…]/.test(next)) continue;\n			}\n			out += ch;\n		}\n		return out.replace(/[「」『』“”\"]/g, \"\").replace(/([!?！？])[:：]+/g, \"$1\").replace(/\\s+/g, \" \").trim();\n	}\n	const HAN = /\\p{Script=Han}/u;\n	/**\n	* The line a small line annotates: same orientation, ≥1.8× larger glyphs (ruby is at most about half size), touching\n	* it (right of a column / above a row; measured gaps on real pages are −0.33…+0.11 G, neighbouring dialogue columns\n	* start at ~0.23 G) and spanning it.\n	*/\n	function rubyBase(l, lines) {\n		const g = glyphSize(l);\n		const len = l.vertical ? l.box.h : l.box.w;\n		let best = null;\n		let bestGap = Infinity;\n		for (const o of lines) {\n			if (o === l || !!o.vertical !== !!l.vertical) continue;\n			const G = glyphSize(o);\n			if (G < g * 1.8) continue;\n			const { gap, overlap } = relation(l, o);\n			if (gap > G * .2 || gap < -Math.max(g, G * .5) || overlap < len * .5) continue;\n			if (!(l.vertical ? l.box.x >= o.box.x + o.box.w * .5 : l.box.y + l.box.h <= o.box.y + o.box.h * .5)) continue;\n			if (gap < bestGap) {\n				bestGap = gap;\n				best = o;\n			}\n		}\n		return best;\n	}\n	/**\n	* Remove ruby (furigana) lines. Their boxes stay attached to the base line (erased together); with mode 'on' the\n	* annotated words are marked in the base text and katakana/kanji/foreign ruby is kept as notes (see ruby.ts).\n	* Hiragana ruby is a reading aid and is dropped in either mode.\n	*/\n	/** (ruby line, base line) pairs on a page — exported for tests */\n	function findRubyPairs(lines) {\n		const pairs = [];\n		for (const l of lines) {\n			if (!rubyCandidate(l)) continue;\n			const base = rubyBase(l, lines);\n			if (base) pairs.push({\n				ruby: l,\n				base,\n				gap: relation(l, base).gap\n			});\n		}\n		return pairs;\n	}\n	function handleFurigana(lines, mode = \"on\") {\n		if (lines.length < 2) return lines;\n		const pairs = findRubyPairs(lines);\n		if (!pairs.length) return lines;\n		const rubies = new Set(pairs.map((p) => p.ruby));\n		const sideNotes = /* @__PURE__ */ new Set();\n		const perBase = /* @__PURE__ */ new Map();\n		for (const { ruby, base } of pairs) {\n			if (mode !== \"on\") {\n				base.rubyBoxes = [...base.rubyBoxes ?? [], ruby.box];\n				continue;\n			}\n			const kind = classifyRuby(ruby.text);\n			if (kind === \"ignore\") continue;\n			const range = rubyWordRange(base, ruby) ?? [0, 0];\n			if (HAN.test(ruby.text) && base.words?.length && base.words.slice(range[0], range[1] + 1).some((w) => HAN.test(w.text))) {\n				sideNotes.add(ruby);\n				continue;\n			}\n			let list = perBase.get(base);\n			if (!list) perBase.set(base, list = []);\n			list.push({\n				from: range[0],\n				to: range[1],\n				note: {\n					text: ruby.text.replace(/\\s+/g, \"\"),\n					kind\n				}\n			});\n		}\n		if (mode === \"on\") {\n			for (const { ruby, base } of pairs) if (!sideNotes.has(ruby)) base.rubyBoxes = [...base.rubyBoxes ?? [], ruby.box];\n		}\n		for (const [base, items] of perBase) markRubies(base, items);\n		return lines.filter((l) => !rubies.has(l) || sideNotes.has(l));\n	}\n	/** Sort blocks in reading order: rows (bands) top→bottom, within a band right→left for manga, left→right otherwise. */\n	function sortReadingOrder(regions, rtl) {\n		const rs = regions.slice();\n		if (!rs.length) return rs;\n		const bandH = Math.max(40, rs.reduce((s, r) => s + r.box.h, 0) / rs.length * 1.2);\n		return rs.sort((a, b) => {\n			const ba = Math.floor((a.box.y + a.box.h / 2) / bandH);\n			const bb = Math.floor((b.box.y + b.box.h / 2) / bandH);\n			if (ba !== bb) return ba - bb;\n			const ca = a.box.x + a.box.w / 2;\n			const cb = b.box.x + b.box.w / 2;\n			return rtl ? cb - ca : ca - cb;\n		});\n	}\n	/** Drop obvious junk: tiny boxes, page numbers, lone punctuation. */\n	function filterRegions(regions, pageW, pageH) {\n		return regions.filter((r) => {\n			if (!r.src) return false;\n			const minSide = Math.min(pageW, pageH);\n			if (r.box.w < minSide * .01 && r.box.h < minSide * .01) return false;\n			if (/^[\\d\\s\\-–—.·•|]+$/.test(r.src)) return false;\n			if (r.src.replace(/[\\s\\p{P}]/gu, \"\").length === 0) return false;\n			return true;\n		});\n	}\n	/**\n	* Mark probable sound effects: much larger glyphs than the page median, few\n	* characters, or visibly tilted. Only meaningful with ≥ 2 regions.\n	*/\n	function tagSfx(regions, isFlat) {\n		if (regions.length < 2) return;\n		const glyphs = regions.map((r) => {\n			const g = r.lines.map(glyphSize).sort((a, b) => a - b);\n			return g.length ? g[g.length >> 1] : r.vertical ? r.box.w : r.box.h;\n		});\n		const med = glyphs.slice().sort((a, b) => a - b)[glyphs.length >> 1];\n		regions.forEach((r, i) => {\n			if (r.kind !== \"unknown\") return;\n			if (r.lines.some((l) => l.rubyBoxes?.length)) return;\n			const chars = r.src.replace(/\\s/g, \"\").length;\n			const tilted = r.lines.some((l) => l.angle !== void 0 && !l.vertical && Math.abs(l.angle) > .08);\n			if (glyphs[i] > med * 2.2 && !/\\p{Script=Han}/u.test(r.src) && !(isFlat?.(r.box) ?? false) && chars <= 12 && r.lines.length <= 2 || tilted && chars <= 12) r.kind = \"sfx\";\n		});\n	}\n	//#endregion\n	//#region src/core/raster.ts\n	const browserRaster = {\n		async decode(bytes, mime) {\n			const blob = new Blob([bytes], { type: mime || sniffMime(bytes) });\n			let bmp;\n			try {\n				bmp = await createImageBitmap(blob, { imageOrientation: \"from-image\" });\n			} catch {\n				bmp = await createImageBitmap(blob);\n			}\n			return {\n				width: bmp.width,\n				height: bmp.height,\n				source: bmp,\n				close: () => bmp.close()\n			};\n		},\n		createCanvas(width, height) {\n			if (typeof OffscreenCanvas !== \"undefined\") return new OffscreenCanvas(width, height);\n			const c = document.createElement(\"canvas\");\n			c.width = width;\n			c.height = height;\n			return c;\n		},\n		async encode(canvas, mime, quality = .9) {\n			let blob;\n			if (typeof OffscreenCanvas !== \"undefined\" && canvas instanceof OffscreenCanvas) blob = await canvas.convertToBlob({\n				type: mime,\n				quality\n			});\n			else blob = await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(/* @__PURE__ */ new Error(\"toBlob failed\")), mime, quality));\n			return new Uint8Array(await blob.arrayBuffer());\n		}\n	};\n	function sniffMime(b) {\n		if (b[0] === 255 && b[1] === 216) return \"image/jpeg\";\n		if (b[0] === 137 && b[1] === 80) return \"image/png\";\n		if (b[0] === 82 && b[1] === 73 && b[8] === 87) return \"image/webp\";\n		if (b[0] === 71 && b[1] === 73) return \"image/gif\";\n		if (b[0] === 66 && b[1] === 77) return \"image/bmp\";\n		if (b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) return \"image/avif\";\n		return \"application/octet-stream\";\n	}\n	/** Downscale + JPEG-encode for upload to OCR / LLM APIs. */\n	async function prepareUpload(raster, img, maxSide, quality = .85, maxBytes = 38e5) {\n		let scale = Math.min(1, maxSide / Math.max(img.width, img.height));\n		for (let attempt = 0; attempt < 4; attempt++) {\n			const w = Math.max(1, Math.round(img.width * scale));\n			const h = Math.max(1, Math.round(img.height * scale));\n			const c = raster.createCanvas(w, h);\n			const ctx = c.getContext(\"2d\");\n			ctx.fillStyle = \"#fff\";\n			ctx.fillRect(0, 0, w, h);\n			ctx.drawImage(img.source, 0, 0, w, h);\n			const bytes = await raster.encode(c, \"image/jpeg\", quality);\n			if (bytes.byteLength <= maxBytes || attempt === 3) return {\n				bytes,\n				mime: \"image/jpeg\",\n				width: w,\n				height: h,\n				scale: img.width / w\n			};\n			scale *= .75;\n		}\n		throw new Error(\"unreachable\");\n	}\n	//#endregion\n	//#region src/core/render.ts\n	const luma = (c) => .299 * c[0] + .587 * c[1] + .114 * c[2];\n	const WORD_CHAR = /[\\p{Script=Hangul}A-Za-z0-9À-ÿ]/u;\n	/**\n	* Greedy wrap. 'words': Hangul/Latin words stay whole (Japanese/Chinese may break between any characters).\n	* 'chars': any character may start a new line, but a word boundary close to the line end is preferred.\n	*/\n	function wrapText(ctx, text, maxWidth, mode = \"words\") {\n		const lines = [];\n		let forcedBreaks = 0;\n		let wordSplits = 0;\n		let doubleSplits = 0;\n		const width = (s) => ctx.measureText(s.trimEnd()).width;\n		for (const para of text.split(/\\n/)) {\n			const tokens = mode === \"chars\" ? tokenizeChars(para) : tokenize(para);\n			let cur = [];\n			let curWordSplit = false;\n			const flush = () => {\n				lines.push(cur.join(\"\").trimEnd());\n				cur = [];\n			};\n			const breakLine = (next) => {\n				if (mode === \"chars\") {\n					const last = cur[cur.length - 1];\n					if (!(!/\\s$/.test(last) && WORD_CHAR.test(last.slice(-1)) && WORD_CHAR.test(next.charAt(0)))) {\n						flush();\n						return;\n					}\n					let k = -1;\n					for (let i = cur.length - 1; i > 0; i--) if (/\\s$/.test(cur[i - 1])) {\n						k = i;\n						break;\n					}\n					if (k > 0 && (curWordSplit || width(cur.slice(0, k).join(\"\")) >= .4 * width(cur.join(\"\")))) {\n						const rest = cur.slice(k);\n						cur = cur.slice(0, k);\n						flush();\n						cur = rest;\n						return;\n					}\n					wordSplits++;\n					if (curWordSplit) doubleSplits++;\n					curWordSplit = true;\n				}\n				flush();\n			};\n			for (const tok of tokens) {\n				while (cur.length && width(cur.join(\"\") + tok) > maxWidth) breakLine(tok);\n				if (!cur.length && width(tok) > maxWidth && tok.trim().length > 1) {\n					forcedBreaks++;\n					let part = \"\";\n					for (const ch of tok) if (part && ctx.measureText(part + ch).width > maxWidth) {\n						lines.push(part.trimEnd());\n						part = ch;\n					} else part += ch;\n					cur = [part];\n				} else cur.push(tok);\n				if (/\\s$/.test(tok) || !WORD_CHAR.test(tok.trimEnd().slice(-1))) curWordSplit = false;\n			}\n			flush();\n		}\n		return {\n			lines: lines.filter((l, i, a) => l.length || i > 0 && i < a.length - 1),\n			forcedBreaks,\n			wordSplits,\n			doubleSplits\n		};\n	}\n	const WORD = String.raw`[\\p{Script=Hangul}A-Za-z0-9À-ÿ'’\\-·]+`;\n	const TRAIL = String.raw`[?!.,:;…~）」』\\)\\]\"”'’]*`;\n	const TOKEN_RE = new RegExp(`${WORD}${TRAIL}\\\\s*|[\\\\(\\\\[（「『\"“]?[^\\\\s\\\\p{Script=Hangul}A-Za-z0-9À-ÿ?!.,:;…~）」』\\\\)\\\\]\"”]${TRAIL}\\\\s*|\\\\S\\\\s*`, \"gu\");\n	/** Split into wrap tokens: Hangul/Latin words (+ trailing punctuation), single CJK ideographs/kana (+ trailing punctuation). */\n	function tokenize(s) {\n		const out = [];\n		for (const m of s.matchAll(TOKEN_RE)) out.push(m[0]);\n		return out;\n	}\n	const CHAR_RE = new RegExp(String.raw`[\\(\\[（「『\"“]?[^\\s][?!.,:;…~）」』\\)\\]\"”'’]*\\s*`, \"gu\");\n	/** One token per character; closing punctuation sticks to the character before it, opening punctuation to the one after (kinsoku). */\n	function tokenizeChars(s) {\n		const out = [];\n		for (const m of s.matchAll(CHAR_RE)) out.push(m[0]);\n		return out;\n	}\n	/** ruby glyph size and the extra advance above a line that carries ruby, in units of the main font size */\n	const RUBY_RATIO = .5;\n	const RUBY_GAP = .55;\n	/** Character offset of each wrapped line inside the text it was wrapped from (lines are in-order substrings). */\n	function lineStarts(text, lines) {\n		const out = [];\n		let cur = 0;\n		for (const l of lines) {\n			const i = l ? text.indexOf(l, cur) : -1;\n			if (i < 0) {\n				out.push(cur);\n				continue;\n			}\n			out.push(i);\n			cur = i + l.length;\n		}\n		return out;\n	}\n	/** Each ruby mark goes to the first line it touches (a word broken across lines carries its ruby once). */\n	function assignMarks(text, lines, marks) {\n		const st = lineStarts(text, lines);\n		const used = /* @__PURE__ */ new Set();\n		return lines.map((l, i) => {\n			const on = marks.filter((m) => !used.has(m) && l.length > 0 && m.start < st[i] + l.length && m.end > st[i]);\n			on.forEach((m) => used.add(m));\n			return on;\n		});\n	}\n	/** Height of a wrapped block; lines with ruby above them get RUBY_GAP extra. */\n	function blockHeight(text, lines, px, lh, marks) {\n		if (!marks?.length) return lines.length * px * lh;\n		return assignMarks(text, lines, marks).reduce((acc, on) => acc + px * lh + (on.length ? px * RUBY_GAP : 0), 0);\n	}\n	/**\n	* Largest font size whose wrapped text fits into w×h. Word-level wrapping is used whenever it reaches the\n	* readability floor; below that, character-level wrapping (normal in Korean manga typesetting) is allowed,\n	* preferring sizes that break few words.\n	*/\n	function fitText(ctx, text, w, h, opts, maxPx = opts.maxFontPx, floorPx = 0, marks) {\n		const lh = opts.lineHeight ?? 1.18;\n		const weight = opts.bold ? \"700\" : \"500\";\n		const fits = (px, mode, lax = false) => {\n			ctx.font = `${weight} ${px}px ${opts.font}`;\n			const wr = wrapText(ctx, text, w, mode);\n			if (mode === \"words\" && wr.forcedBreaks > 0) return null;\n			if (mode === \"chars\" && !lax && wr.doubleSplits > 0) return null;\n			if (blockHeight(text, wr.lines, px, lh, marks) > h) return null;\n			for (const l of wr.lines) if (ctx.measureText(l).width > w) return null;\n			return wr;\n		};\n		const hiPx = Math.max(opts.minFontPx, Math.min(maxPx, h));\n		const search = (mode, lax = false) => {\n			let lo = opts.minFontPx;\n			let hi = hiPx;\n			let best = null;\n			while (lo <= hi) {\n				const mid = lo + hi >> 1;\n				const wr = fits(mid, mode, lax);\n				if (wr) {\n					best = {\n						fontPx: mid,\n						lines: wr.lines,\n						lineHeight: lh,\n						mode\n					};\n					lo = mid + 1;\n				} else hi = mid - 1;\n			}\n			return best;\n		};\n		const byWords = search(\"words\");\n		let best = byWords;\n		if (!byWords || byWords.fontPx < floorPx) {\n			const top = search(\"chars\", true);\n			if (top) {\n				const score = (px, wr) => px * Math.pow(.8, wr.wordSplits) * Math.pow(.6, wr.doubleSplits);\n				let above = null;\n				let any = null;\n				const stop = Math.max(opts.minFontPx, byWords ? byWords.fontPx + 1 : opts.minFontPx);\n				for (let px = top.fontPx; px >= stop; px--) {\n					if (above && px < floorPx) break;\n					const wr = fits(px, \"chars\", true);\n					if (!wr) continue;\n					const cand = {\n						lay: {\n							fontPx: px,\n							lines: wr.lines,\n							lineHeight: lh,\n							mode: \"chars\"\n						},\n						score: score(px, wr)\n					};\n					if (px >= floorPx && (!above || cand.score > above.score)) above = cand;\n					if (!any || cand.score > any.score) any = cand;\n				}\n				const pick = above ?? any;\n				if (pick && (!byWords || pick === above || pick.score > byWords.fontPx)) best = pick.lay;\n			}\n		}\n		if (!best) {\n			ctx.font = `${weight} ${opts.minFontPx}px ${opts.font}`;\n			best = {\n				fontPx: opts.minFontPx,\n				lines: wrapText(ctx, text, Math.max(w, opts.minFontPx * 2), \"chars\").lines,\n				lineHeight: lh,\n				mode: \"chars\"\n			};\n		}\n		ctx.font = `${weight} ${best.fontPx}px ${opts.font}`;\n		const n = best.lines.length;\n		if (n > 1) {\n			const splits0 = best.mode === \"chars\" ? wrapText(ctx, text, w, \"chars\").wordSplits : 0;\n			for (let f = .95; f >= .55; f -= .05) {\n				const wr = wrapText(ctx, text, w * f, best.mode);\n				if (wr.lines.length !== n || best.mode === \"words\" && wr.forcedBreaks > 0 || wr.wordSplits > splits0 || wr.lines.some((l) => ctx.measureText(l).width > w)) break;\n				best.lines = wr.lines;\n			}\n		}\n		return best;\n	}\n	/**\n	* Keep the text readable: when the fitted font falls below the floor, re-wrap at the floor size and let the\n	* block grow past the layout rect (up to maxOverflow×). The caller draws a backing pill for such blocks.\n	*/\n	function enforceFloor(ctx, text, w, h, opts, layout, floorPx, marks) {\n		if (layout.fontPx >= floorPx) return layout;\n		const lh = opts.lineHeight ?? 1.18;\n		const weight = opts.bold ? \"700\" : \"500\";\n		const maxOverflow = opts.maxOverflow ?? 1.6;\n		ctx.font = `${weight} ${floorPx}px ${opts.font}`;\n		let pick = null;\n		let pickCost = Infinity;\n		for (let f = 1; f <= maxOverflow + 1e-6; f += .15) {\n			const wr = wrapText(ctx, text, w * f, \"chars\");\n			const need = blockHeight(text, wr.lines, floorPx, lh, marks);\n			const widest = Math.max(...wr.lines.map((l) => ctx.measureText(l).width));\n			const fx = Math.max(1, widest / w);\n			const fy = need / h;\n			const cost = Math.max(fx, fy) + .1 * (fx + fy) + .05 * wr.wordSplits;\n			if (cost < pickCost) {\n				pickCost = cost;\n				pick = {\n					fontPx: floorPx,\n					lines: wr.lines,\n					lineHeight: lh,\n					mode: \"chars\",\n					overflow: true,\n					blockW: widest\n				};\n			}\n		}\n		return pick ?? layout;\n	}\n	/** Original glyph size of a region: caps the target font so translations do not shout. */\n	function sourceGlyphPx(region) {\n		const ls = (region.lines ?? []).filter((l) => l.words?.length || region.lines.length >= 2);\n		if (ls.length) {\n			const sizes = ls.map((l) => region.vertical ? l.box.w : l.box.h).sort((a, b) => a - b);\n			return sizes[sizes.length >> 1];\n		}\n		const chars = Math.max(1, region.src.replace(/\\s/g, \"\").length);\n		const area = region.box.w * region.box.h;\n		return Math.sqrt(area / chars) * 1.05;\n	}\n	/**\n	* Work out where and how large the translation of `region` will be, without drawing anything.\n	* `capPx` overrides the per-region source-glyph cap: page-level font unification calls this once\n	* to learn each block's natural size, then re-plans oversized blocks against the page's median.\n	*/\n	function planRegion(ctx, region, opts, capPx) {\n		const text = region.dst?.trim();\n		if (!text) return null;\n		const lead = region.dst.length - region.dst.trimStart().length;\n		const marks = (region.rubyMarks ?? []).map((m) => ({\n			text: m.text,\n			start: Math.max(0, m.start - lead),\n			end: Math.min(text.length, m.end - lead)\n		})).filter((m) => m.end > m.start && m.text);\n		const lay = region.layout ?? region.box;\n		const padX = Math.max(2, lay.w * .04);\n		const padY = Math.max(2, lay.h * .04);\n		const w = Math.max(8, lay.w - padX * 2);\n		const h = Math.max(8, lay.h - padY * 2);\n		const sourceCap = Math.max(opts.minFontPx + 2, Math.min(opts.maxFontPx, sourceGlyphPx(region) * (region.vertical ? 1.05 : 1.3)));\n		const cap = capPx !== void 0 ? Math.max(opts.minFontPx, Math.min(capPx, sourceCap)) : sourceCap;\n		const pageW = ctx.canvas?.width ?? 0;\n		const floorPx = Math.floor(Math.min(cap, Math.max(opts.minFontPx, pageW * (opts.floorRatio ?? .015))));\n		const layout = enforceFloor(ctx, text, w, h, opts, fitText(ctx, text, w, h, opts, cap, floorPx, marks), floorPx, marks);\n		const bg = region.bg ?? [\n			255,\n			255,\n			255\n		];\n		return {\n			region,\n			text,\n			marks,\n			lay,\n			padX,\n			padY,\n			w,\n			h,\n			layout,\n			bg,\n			dark: luma(bg) < 128\n		};\n	}\n	function drawPlan(ctx, plan, opts) {\n		const { region, text, marks, lay, padX, padY, layout, bg, dark } = plan;\n		const pageW = ctx.canvas?.width ?? 0;\n		const pageH = ctx.canvas?.height ?? 0;\n		const fill = dark ? \"#ffffff\" : \"#111111\";\n		const stroke = `rgb(${bg[0]},${bg[1]},${bg[2]})`;\n		ctx.save();\n		const weight = opts.bold ? \"700\" : \"500\";\n		const mainFont = `${weight} ${layout.fontPx}px ${opts.font}`;\n		ctx.font = mainFont;\n		ctx.textAlign = \"center\";\n		ctx.textBaseline = \"middle\";\n		const total = blockHeight(text, layout.lines, layout.fontPx, layout.lineHeight, marks);\n		const starts = lineStarts(text, layout.lines);\n		const perLine = assignMarks(text, layout.lines, marks);\n		const widest = Math.max(...layout.lines.map((l) => ctx.measureText(l).width));\n		const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);\n		let cx = clamp(region.box.x + region.box.w / 2, lay.x + padX + widest / 2, lay.x + lay.w - padX - widest / 2);\n		let cy = clamp(region.box.y + region.box.h / 2, lay.y + padY + total / 2, lay.y + lay.h - padY - total / 2);\n		if (layout.overflow && pageW && pageH) {\n			const m = layout.fontPx * .5;\n			cx = Math.min(Math.max(cx, widest / 2 + m), pageW - widest / 2 - m);\n			cy = Math.min(Math.max(cy, total / 2 + m), pageH - total / 2 - m);\n		}\n		let y = cy - total / 2;\n		const overArt = region.flat === false && region.kind !== \"bubble\";\n		const needStroke = !region.flat || region.kind === \"sfx\" || !!layout.overflow;\n		if (overArt || layout.overflow) {\n			ctx.fillStyle = overArt ? dark ? \"rgba(0,0,0,0.55)\" : \"rgba(255,255,255,0.78)\" : `rgba(${bg[0]},${bg[1]},${bg[2]},0.92)`;\n			const bw = widest + layout.fontPx * .8;\n			const bh = total + layout.fontPx * .4;\n			roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, layout.fontPx * .5);\n			ctx.fill();\n		}\n		const paint = (s, x, yy, px) => {\n			if (needStroke) {\n				ctx.lineJoin = \"round\";\n				ctx.lineWidth = Math.max(1.5, px * .18);\n				ctx.strokeStyle = dark ? \"rgba(0,0,0,0.9)\" : stroke;\n				ctx.strokeText(s, x, yy);\n			}\n			ctx.fillStyle = fill;\n			ctx.fillText(s, x, yy);\n		};\n		layout.lines.forEach((line, i) => {\n			const onLine = perLine[i];\n			if (onLine.length) y += layout.fontPx * RUBY_GAP;\n			const mid = y + layout.fontPx * layout.lineHeight / 2;\n			ctx.font = mainFont;\n			paint(line, cx, mid, layout.fontPx);\n			if (onLine.length) {\n				const lineW = ctx.measureText(line).width;\n				const left = cx - lineW / 2;\n				for (const m of onLine) {\n					const a = Math.max(0, m.start - starts[i]);\n					const b = Math.min(line.length, m.end - starts[i]);\n					ctx.font = mainFont;\n					const x0 = left + ctx.measureText(line.slice(0, a)).width;\n					const x1 = left + ctx.measureText(line.slice(0, b)).width;\n					let rpx = Math.max(7, Math.round(layout.fontPx * RUBY_RATIO));\n					ctx.font = `${weight} ${rpx}px ${opts.font}`;\n					if (ctx.measureText(m.text).width > x1 - x0 + layout.fontPx) {\n						rpx = Math.max(7, Math.round(layout.fontPx * .38));\n						ctx.font = `${weight} ${rpx}px ${opts.font}`;\n					}\n					paint(m.text, (x0 + x1) / 2, mid - layout.fontPx * .5 - rpx * .4, rpx);\n				}\n			}\n			y += layout.fontPx * layout.lineHeight;\n		});\n		ctx.restore();\n		return layout;\n	}\n	function roundRect(ctx, x, y, w, h, r) {\n		const rr = Math.min(r, w / 2, h / 2);\n		ctx.beginPath();\n		ctx.moveTo(x + rr, y);\n		ctx.arcTo(x + w, y, x + w, y + h, rr);\n		ctx.arcTo(x + w, y + h, x, y + h, rr);\n		ctx.arcTo(x, y + h, x, y, rr);\n		ctx.arcTo(x, y, x + w, y, rr);\n		ctx.closePath();\n	}\n	//#endregion\n	//#region src/core/types.ts\n	var ProviderError = class extends Error {\n		provider;\n		status;\n		terminal;\n		constructor(message, provider, status, terminal = false) {\n			super(message);\n			this.provider = provider;\n			this.status = status;\n			this.terminal = terminal;\n			this.name = \"ProviderError\";\n		}\n	};\n	//#endregion\n	//#region src/core/limiter.ts\n	const SPECS = {\n		lens: {\n			minIntervalMs: 700,\n			cooldownMs: 6e4\n		},\n		\"google-unofficial\": {\n			minIntervalMs: 300,\n			cooldownMs: 12e4\n		},\n		papago: {\n			minIntervalMs: 500,\n			cooldownMs: 12e4\n		},\n		deepl: {\n			minIntervalMs: 1500,\n			cooldownMs: 6e5\n		},\n		gemini: {\n			minIntervalMs: 6500,\n			cooldownMs: 65e3\n		},\n		default: {\n			minIntervalMs: 500,\n			cooldownMs: 6e4\n		}\n	};\n	var Limiter = class {\n		states = /* @__PURE__ */ new Map();\n		state(id) {\n			let s = this.states.get(id);\n			if (!s) {\n				s = {\n					next: 0,\n					cooldownUntil: 0,\n					chain: Promise.resolve()\n				};\n				this.states.set(id, s);\n			}\n			return s;\n		}\n		spec(id) {\n			return SPECS[id] ?? SPECS[id.split(\":\")[0]] ?? SPECS.default;\n		}\n		isCoolingDown(id) {\n			return this.state(id).cooldownUntil > Date.now();\n		}\n		cooldownRemaining(id) {\n			return Math.max(0, this.state(id).cooldownUntil - Date.now());\n		}\n		/** Resolves when the caller may send a request to `id`. Serialises callers per provider. */\n		acquire(id, signal) {\n			const s = this.state(id);\n			const spec = this.spec(id);\n			const p = s.chain.then(async () => {\n				const wait = Math.max(s.next, s.cooldownUntil) - Date.now();\n				if (wait > 0) await sleep(wait, signal);\n				s.next = Date.now() + spec.minIntervalMs;\n			});\n			s.chain = p.catch(() => void 0);\n			return p;\n		}\n		reportTerminal(id, retryAfterMs) {\n			const s = this.state(id);\n			s.cooldownUntil = Date.now() + (retryAfterMs ?? this.spec(id).cooldownMs);\n		}\n	};\n	function sleep(ms, signal) {\n		return new Promise((resolve, reject) => {\n			if (signal?.aborted) return reject(new DOMException(\"aborted\", \"AbortError\"));\n			const t = setTimeout(resolve, ms);\n			signal?.addEventListener(\"abort\", () => {\n				clearTimeout(t);\n				reject(new DOMException(\"aborted\", \"AbortError\"));\n			});\n		});\n	}\n	const limiter = new Limiter();\n	//#endregion\n	//#region src/providers/deepl.ts\n	const td$4 = new TextDecoder();\n	const ENDPOINT$1 = \"https://www2.deepl.com/jsonrpc\";\n	const MAX_JOBS = 50;\n	const LANG$1 = {\n		ko: \"KO\",\n		en: \"EN\",\n		ja: \"JA\",\n		zh: \"ZH\",\n		\"zh-CN\": \"ZH\",\n		\"zh-TW\": \"ZH\",\n		de: \"DE\",\n		fr: \"FR\",\n		es: \"ES\",\n		it: \"IT\",\n		pt: \"PT\",\n		ru: \"RU\",\n		id: \"ID\",\n		auto: \"auto\"\n	};\n	function deeplSupports(sl, tl) {\n		return !!LANG$1[tl] && tl !== \"auto\" && (sl === \"auto\" || !!LANG$1[sl]);\n	}\n	function timestamp(text) {\n		let n = 0;\n		for (const ch of text) if (ch === \"i\") n++;\n		const now = Date.now();\n		if (!n) return now;\n		n++;\n		return now - now % n + n;\n	}\n	async function request$1(texts, sl, tl, signal) {\n		const id = (Math.floor(Math.random() * 99999) + 83e5) * 1e3;\n		const jobs = texts.map((t, i) => ({\n			kind: \"default\",\n			preferred_num_beams: 1,\n			raw_en_context_before: [],\n			raw_en_context_after: [],\n			sentences: [{\n				prefix: \"\",\n				text: t,\n				id: i + 1\n			}]\n		}));\n		const body = {\n			jsonrpc: \"2.0\",\n			method: \"LMT_handle_jobs\",\n			id,\n			params: {\n				commonJobParams: {\n					mode: \"translate\",\n					formality: \"undefined\",\n					transcribe_as: \"romanize\",\n					advancedMode: false,\n					textType: \"plaintext\",\n					wasSpoken: false\n				},\n				lang: sl === \"auto\" ? { target_lang: LANG$1[tl] } : {\n					source_lang_computed: LANG$1[sl],\n					target_lang: LANG$1[tl]\n				},\n				jobs,\n				priority: 1,\n				timestamp: timestamp(texts.join(\"\"))\n			}\n		};\n		let json = JSON.stringify(body);\n		json = json.replace(\"\\\"method\\\":\\\"\", (id + 5) % 29 === 0 || (id + 3) % 13 === 0 ? \"\\\"method\\\" : \\\"\" : \"\\\"method\\\": \\\"\");\n		const r = await gmRequest({\n			url: ENDPOINT$1,\n			method: \"POST\",\n			headers: {\n				\"Content-Type\": \"application/json\",\n				Accept: \"*/*\",\n				Origin: \"https://www.deepl.com\",\n				Referer: \"https://www.deepl.com/\"\n			},\n			body: json,\n			signal,\n			timeoutMs: 2e4\n		});\n		if (r.status === 429 || r.status === 403 || r.status === 401) throw new ProviderError(`deepl HTTP ${r.status}`, \"deepl\", r.status, true);\n		if (r.status !== 200) throw new ProviderError(`deepl HTTP ${r.status}`, \"deepl\", r.status);\n		const data = JSON.parse(td$4.decode(r.body));\n		if (data?.error) throw new ProviderError(`deepl: ${data.error.message ?? \"error\"}`, \"deepl\", data.error.code);\n		const tr = data?.result?.translations ?? [];\n		if (tr.length !== texts.length) throw new ProviderError(`deepl returned ${tr.length} jobs for ${texts.length}`, \"deepl\");\n		return tr.map((j) => (j?.beams?.[0]?.sentences ?? []).map((s) => s?.text ?? \"\").join(\"\"));\n	}\n	async function deeplTranslate(texts, sl, tl, signal) {\n		if (!texts.length) return [];\n		if (!deeplSupports(sl, tl)) throw new ProviderError(`deepl: unsupported pair ${sl}→${tl}`, \"deepl\", 400, true);\n		const clean = texts.map((t) => t.replace(/\\s*\\n\\s*/g, \" \").trim());\n		const out = new Array(clean.length).fill(\"\");\n		const idx = clean.map((_, i) => i).filter((i) => clean[i]);\n		for (let k = 0; k < idx.length; k += MAX_JOBS) {\n			const part = idx.slice(k, k + MAX_JOBS);\n			const res = await request$1(part.map((i) => clean[i]), sl, tl, signal);\n			part.forEach((i, j) => out[i] = res[j].trim());\n		}\n		return out;\n	}\n	//#endregion\n	//#region src/providers/gemini.ts\n	const td$3 = new TextDecoder();\n	const LANG_NAMES = {\n		ja: \"Japanese\",\n		ko: \"Korean\",\n		en: \"English\",\n		zh: \"Chinese\",\n		auto: \"the source language (detect it)\"\n	};\n	const name = (l) => LANG_NAMES[l] ?? l;\n	function b64(bytes) {\n		let s = \"\";\n		const chunk = 32768;\n		for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));\n		return btoa(s);\n	}\n	function thinkingConfig(model) {\n		if (/gemini-2\\.5/.test(model)) return { thinkingBudget: 0 };\n		if (/gemini-3/.test(model)) return { thinkingLevel: \"low\" };\n	}\n	async function generate(model, key, body, signal) {\n		const r = await gmRequest({\n			url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,\n			method: \"POST\",\n			headers: { \"Content-Type\": \"application/json\" },\n			body: JSON.stringify(body),\n			signal,\n			timeoutMs: 9e4\n		});\n		const text = td$3.decode(r.body);\n		if (r.status === 429) throw new ProviderError(`Gemini ${model} rate limited (429)`, `gemini:${model}`, 429, true);\n		if (r.status === 400 && /API key/i.test(text)) throw new ProviderError(\"Gemini API key invalid\", `gemini:${model}`, 400, true);\n		if (r.status < 200 || r.status >= 300) throw new ProviderError(`Gemini ${model} HTTP ${r.status}: ${text.slice(0, 200)}`, `gemini:${model}`, r.status, r.status === 403);\n		const json = JSON.parse(text);\n		const part = json?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === \"string\");\n		if (!part) throw new ProviderError(`Gemini ${model}: empty response (${json?.candidates?.[0]?.finishReason ?? \"no candidates\"})`, `gemini:${model}`);\n		return JSON.parse(part.text);\n	}\n	function historyBlock(ctx) {\n		const h = ctx.history.slice(-24);\n		if (!h.length) return \"\";\n		return `\\nPrevious pages (source → translation), keep names, honorifics and tone consistent with these:\\n${h.map((p) => `- ${p.src} → ${p.dst}`).join(\"\\n\")}\\n`;\n	}\n	function glossaryBlock(ctx) {\n		const g = Object.entries(ctx.glossary);\n		if (!g.length) return \"\";\n		return `\\nGlossary (always use these):\\n${g.map(([k, v]) => `- ${k} → ${v}`).join(\"\\n\")}\\n`;\n	}\n	const ONESHOT_SCHEMA = {\n		type: \"ARRAY\",\n		items: {\n			type: \"OBJECT\",\n			properties: {\n				box_2d: {\n					type: \"ARRAY\",\n					items: { type: \"INTEGER\" },\n					description: \"[ymin, xmin, ymax, xmax] normalised to 0-1000\"\n				},\n				src: { type: \"STRING\" },\n				dst: { type: \"STRING\" },\n				kind: {\n					type: \"STRING\",\n					enum: [\n						\"bubble\",\n						\"caption\",\n						\"sfx\"\n					]\n				},\n				vertical: { type: \"BOOLEAN\" }\n			},\n			required: [\n				\"box_2d\",\n				\"src\",\n				\"dst\",\n				\"kind\"\n			],\n			propertyOrdering: [\n				\"box_2d\",\n				\"kind\",\n				\"vertical\",\n				\"src\",\n				\"dst\"\n			]\n		}\n	};\n	async function geminiOneshot(img, ctx, opts) {\n		const prompt = `You are a manga OCR + translation engine. Find EVERY text block in this comic page written in ${name(ctx.sourceLang)}: speech bubbles, thought bubbles, captions/narration boxes` + (opts.includeSfx ? \", and sound effects\" : \". Ignore sound effects drawn as art (onomatopoeia) and ignore watermarks/page numbers\") + `.\\nFor each block return box_2d as [ymin, xmin, ymax, xmax] normalised to 0-1000 covering the whole text tightly, kind, vertical (true when the original text runs top-to-bottom), src (the original text, lines joined with a space) and dst (a natural ${name(ctx.targetLang)} translation that fits a speech bubble: concise, colloquial, matching the speaker's tone).\\nRuby (furigana) beside a word: ignore hiragana readings. When the ruby is katakana or kanji, append its translation in ⟨ ⟩ right after the translated word in dst (相棒 with ruby パートナー → 파트너⟨파트너⟩); when the ruby is in Latin or another foreign script, append it verbatim in ⟨ ⟩.\\nOrder blocks in reading order (${ctx.sourceLang === \"ja\" ? \"right-to-left, top-to-bottom\" : \"left-to-right, top-to-bottom\"}). Return an empty array if there is no text.` + glossaryBlock(ctx) + historyBlock(ctx);\n		const body = {\n			contents: [{\n				role: \"user\",\n				parts: [{ inlineData: {\n					mimeType: img.mime,\n					data: b64(img.bytes)\n				} }, { text: prompt }]\n			}],\n			generationConfig: {\n				temperature: .2,\n				responseMimeType: \"application/json\",\n				responseSchema: ONESHOT_SCHEMA,\n				...thinkingConfig(opts.model) ? { thinkingConfig: thinkingConfig(opts.model) } : {}\n			},\n			safetySettings: [\n				\"HARM_CATEGORY_HARASSMENT\",\n				\"HARM_CATEGORY_HATE_SPEECH\",\n				\"HARM_CATEGORY_SEXUALLY_EXPLICIT\",\n				\"HARM_CATEGORY_DANGEROUS_CONTENT\"\n			].map((c) => ({\n				category: c,\n				threshold: \"BLOCK_NONE\"\n			}))\n		};\n		const items = await generate(opts.model, opts.key, body, opts.signal);\n		if (!Array.isArray(items)) throw new ProviderError(\"Gemini oneshot: response is not an array\", `gemini:${opts.model}`);\n		const regions = [];\n		for (const it of items) {\n			const b = it?.box_2d;\n			if (!Array.isArray(b) || b.length !== 4 || typeof it.src !== \"string\") continue;\n			const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(1e3, Math.max(0, Number(v) || 0)));\n			const W = img.width * img.scale;\n			const H = img.height * img.scale;\n			const box = {\n				x: Math.round(xmin / 1e3 * W),\n				y: Math.round(ymin / 1e3 * H),\n				w: Math.max(2, Math.round((xmax - xmin) / 1e3 * W)),\n				h: Math.max(2, Math.round((ymax - ymin) / 1e3 * H))\n			};\n			const kind = it.kind === \"sfx\" || it.kind === \"caption\" || it.kind === \"bubble\" ? it.kind : \"unknown\";\n			if (kind === \"sfx\" && !opts.includeSfx) continue;\n			regions.push({\n				box,\n				lines: [{\n					box,\n					text: it.src\n				}],\n				src: it.src.trim(),\n				dst: String(it.dst ?? \"\").trim(),\n				kind,\n				vertical: !!it.vertical\n			});\n		}\n		return regions;\n	}\n	async function geminiTranslate(texts, ctx, opts) {\n		if (!texts.length) return [];\n		const body = {\n			contents: [{\n				role: \"user\",\n				parts: [{ text: `Translate the following manga speech-bubble texts from ${name(ctx.sourceLang)} to ${name(ctx.targetLang)}. They come from one page in reading order; use the surrounding lines as context. Keep each translation concise and colloquial so it fits a bubble. Some words are wrapped in 〔 〕 (they carry ruby text); keep the corresponding words of the translation wrapped in 〔 〕 too. Return a JSON array of exactly ${texts.length} strings in the same order (empty string if an item is not translatable text).` + glossaryBlock(ctx) + historyBlock(ctx) + `\\nTexts:\\n${JSON.stringify(texts)}` }]\n			}],\n			generationConfig: {\n				temperature: .2,\n				responseMimeType: \"application/json\",\n				responseSchema: {\n					type: \"ARRAY\",\n					items: { type: \"STRING\" }\n				},\n				...thinkingConfig(opts.model) ? { thinkingConfig: thinkingConfig(opts.model) } : {}\n			},\n			safetySettings: [\n				\"HARM_CATEGORY_HARASSMENT\",\n				\"HARM_CATEGORY_HATE_SPEECH\",\n				\"HARM_CATEGORY_SEXUALLY_EXPLICIT\",\n				\"HARM_CATEGORY_DANGEROUS_CONTENT\"\n			].map((c) => ({\n				category: c,\n				threshold: \"BLOCK_NONE\"\n			}))\n		};\n		const out = await generate(opts.model, opts.key, body, opts.signal);\n		if (!Array.isArray(out) || out.length !== texts.length) throw new ProviderError(`Gemini translate: expected ${texts.length} items, got ${Array.isArray(out) ? out.length : typeof out}`, `gemini:${opts.model}`);\n		return out.map((s) => String(s ?? \"\"));\n	}\n	//#endregion\n	//#region src/providers/gtranslate.ts\n	const td$2 = new TextDecoder();\n	function langCode(l) {\n		return {\n			ja: \"ja\",\n			ko: \"ko\",\n			en: \"en\",\n			zh: \"zh-CN\",\n			\"zh-TW\": \"zh-TW\",\n			auto: \"auto\"\n		}[l] ?? l;\n	}\n	async function viaDictChromeEx(texts, sl, tl, signal) {\n		const params = new URLSearchParams();\n		params.set(\"client\", \"dict-chrome-ex\");\n		params.set(\"sl\", langCode(sl));\n		params.set(\"tl\", langCode(tl));\n		for (const t of texts) params.append(\"q\", t);\n		const r = await gmRequest({\n			url: `https://clients5.google.com/translate_a/t?${params.toString()}`,\n			method: \"GET\",\n			headers: { Accept: \"application/json\" },\n			signal,\n			timeoutMs: 2e4\n		});\n		if (r.status === 429 || r.status === 403) throw new ProviderError(`dict-chrome-ex HTTP ${r.status}`, \"google-unofficial\", r.status, true);\n		if (r.status !== 200) throw new ProviderError(`dict-chrome-ex HTTP ${r.status}`, \"google-unofficial\", r.status);\n		const data = JSON.parse(td$2.decode(r.body));\n		const out = [];\n		const arr = Array.isArray(data) ? data : [data];\n		for (const item of arr) if (typeof item === \"string\") out.push(item);\n		else if (Array.isArray(item)) out.push(typeof item[0] === \"string\" ? item[0] : String(item[0] ?? \"\"));\n		else if (item && typeof item === \"object\" && Array.isArray(item.sentences)) out.push(item.sentences.map((s) => s.trans ?? \"\").join(\"\"));\n		else out.push(\"\");\n		if (out.length !== texts.length) throw new ProviderError(`dict-chrome-ex returned ${out.length} items for ${texts.length} inputs`, \"google-unofficial\");\n		return out;\n	}\n	async function viaGtx(text, sl, tl, signal) {\n		const r = await gmRequest({\n			url: `https://translate.googleapis.com/translate_a/single?${new URLSearchParams({\n				client: \"gtx\",\n				sl: langCode(sl),\n				tl: langCode(tl),\n				dt: \"t\",\n				q: text\n			})}`,\n			method: \"GET\",\n			signal,\n			timeoutMs: 2e4\n		});\n		if (r.status === 429 || r.status === 403) throw new ProviderError(`gtx HTTP ${r.status}`, \"google-unofficial\", r.status, true);\n		if (r.status !== 200) throw new ProviderError(`gtx HTTP ${r.status}`, \"google-unofficial\", r.status);\n		return (JSON.parse(td$2.decode(r.body))?.[0] ?? []).map((s) => s?.[0] ?? \"\").join(\"\");\n	}\n	/**\n	* Translate a batch of texts. Each text is one block (bubble); newlines inside a\n	* block are kept out of the request so the engine sees whole sentences.\n	*/\n	async function googleTranslate(texts, sl, tl, signal) {\n		if (texts.length === 0) return [];\n		const clean = texts.map((t) => t.replace(/\\s*\\n\\s*/g, \" \").trim());\n		try {\n			const out = new Array(clean.length).fill(\"\");\n			const idx = clean.map((_, i) => i).filter((i) => clean[i]);\n			const CHUNK = 80;\n			for (let k = 0; k < idx.length; k += CHUNK) {\n				const part = idx.slice(k, k + CHUNK);\n				const res = await viaDictChromeEx(part.map((i) => clean[i]), sl, tl, signal);\n				part.forEach((i, j) => out[i] = res[j]);\n			}\n			return out;\n		} catch (e) {\n			if (e instanceof ProviderError && e.terminal) throw e;\n			const out = [];\n			for (const t of clean) out.push(t ? await viaGtx(t, sl, tl, signal) : \"\");\n			return out;\n		}\n	}\n	//#endregion\n	//#region src/core/proto.ts\n	const te = new TextEncoder();\n	const td$1 = new TextDecoder(\"utf-8\", { fatal: false });\n	function varint(n) {\n		const out = [];\n		let v = n >>> 0;\n		if (n > 4294967295) {\n			let big = BigInt(n);\n			while (big > 127n) {\n				out.push(Number(big & 127n) | 128);\n				big >>= 7n;\n			}\n			out.push(Number(big));\n			return Uint8Array.from(out);\n		}\n		while (v > 127) {\n			out.push(v & 127 | 128);\n			v >>>= 7;\n		}\n		out.push(v);\n		return Uint8Array.from(out);\n	}\n	function concat(parts) {\n		let len = 0;\n		for (const p of parts) len += p.length;\n		const out = new Uint8Array(len);\n		let o = 0;\n		for (const p of parts) {\n			out.set(p, o);\n			o += p.length;\n		}\n		return out;\n	}\n	/** field with varint value */\n	function fInt(field, value) {\n		return concat([varint(field << 3 | 0), varint(value)]);\n	}\n	/** field with length-delimited value (bytes, string or nested message) */\n	function fBytes(field, value) {\n		const bytes = typeof value === \"string\" ? te.encode(value) : value;\n		return concat([\n			varint(field << 3 | 2),\n			varint(bytes.length),\n			bytes\n		]);\n	}\n	function* readFields(buf) {\n		let pos = 0;\n		const readVarint = () => {\n			let result = 0;\n			let shift = 0;\n			for (;;) {\n				if (pos >= buf.length) throw new Error(\"proto: truncated varint\");\n				const b = buf[pos++];\n				if (shift < 28) result |= (b & 127) << shift;\n				else result += (b & 127) * 2 ** shift;\n				if ((b & 128) === 0) break;\n				shift += 7;\n				if (shift > 63) throw new Error(\"proto: varint too long\");\n			}\n			return result >>> 0 === result ? result : result;\n		};\n		while (pos < buf.length) {\n			const tag = readVarint();\n			const field = tag >>> 3;\n			const wire = tag & 7;\n			if (wire === 0) yield {\n				field,\n				wire,\n				value: readVarint()\n			};\n			else if (wire === 1) {\n				if (pos + 8 > buf.length) throw new Error(\"proto: truncated fixed64\");\n				const v = new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(0, true);\n				pos += 8;\n				yield {\n					field,\n					wire,\n					value: v\n				};\n			} else if (wire === 2) {\n				const len = readVarint();\n				if (pos + len > buf.length) throw new Error(\"proto: truncated bytes\");\n				yield {\n					field,\n					wire,\n					value: buf.subarray(pos, pos + len)\n				};\n				pos += len;\n			} else if (wire === 5) {\n				if (pos + 4 > buf.length) throw new Error(\"proto: truncated fixed32\");\n				const v = new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(0, true);\n				pos += 4;\n				yield {\n					field,\n					wire,\n					value: v\n				};\n			} else throw new Error(`proto: unsupported wire type ${wire}`);\n		}\n	}\n	function firstValues(buf) {\n		const map = {};\n		for (const f of readFields(buf)) if (!(f.field in map)) map[f.field] = f.value;\n		return map;\n	}\n	function utf8(b) {\n		return b instanceof Uint8Array ? td$1.decode(b) : \"\";\n	}\n	//#endregion\n	//#region src/providers/lens.ts\n	const LENS_ENDPOINT = \"https://lensfrontend-pa.googleapis.com/v1/crupload\";\n	/** Public client key shipped inside Chrome's Lens overlay (not a secret). */\n	const LENS_API_KEY = \"AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY\";\n	const MAX_BYTES = 4e6;\n	function buildLensRequest(image, width, height, locale = {\n		language: \"en\",\n		region: \"US\",\n		timeZone: \"America/New_York\"\n	}) {\n		const uuid = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);\n		const analytics = /* @__PURE__ */ new Uint8Array(16);\n		const c = globalThis.crypto;\n		if (c && typeof c.getRandomValues === \"function\") c.getRandomValues(analytics);\n		else for (let i = 0; i < 16; i++) analytics[i] = Math.random() * 256 | 0;\n		const requestId = concat([\n			fInt(1, uuid),\n			fInt(2, 1),\n			fInt(3, 1),\n			fBytes(4, analytics)\n		]);\n		const localeCtx = concat([\n			fBytes(1, locale.language),\n			fBytes(2, locale.region),\n			fBytes(3, locale.timeZone)\n		]);\n		const filters = fBytes(1, fInt(1, 7));\n		const clientContext = concat([\n			fInt(1, 2),\n			fInt(2, 4),\n			fBytes(4, localeCtx),\n			fBytes(17, filters)\n		]);\n		const requestContext = concat([fBytes(3, requestId), fBytes(4, clientContext)]);\n		const imageData = concat([fBytes(1, fBytes(1, image)), fBytes(3, concat([fInt(1, width), fInt(2, height)]))]);\n		return fBytes(1, concat([fBytes(1, requestContext), fBytes(3, imageData)]));\n	}\n	function parseBox(chunk) {\n		try {\n			const m = firstValues(chunk);\n			const num = (v) => typeof v === \"number\" ? v : 0;\n			return {\n				cx: num(m[1]),\n				cy: num(m[2]),\n				w: num(m[3]),\n				h: num(m[4]),\n				rotation: num(m[5])\n			};\n		} catch {\n			return null;\n		}\n	}\n	function parseGeometry(chunk) {\n		try {\n			for (const f of readFields(chunk)) if (f.field === 1 && f.wire === 2) return parseBox(f.value);\n		} catch {}\n		return null;\n	}\n	function parseWord(chunk) {\n		const w = {\n			text: \"\",\n			separator: \"\",\n			box: null\n		};\n		for (const f of readFields(chunk)) {\n			if (f.wire !== 2) continue;\n			if (f.field === 2) w.text = utf8(f.value);\n			else if (f.field === 3) w.separator = utf8(f.value);\n			else if (f.field === 4) w.box = parseGeometry(f.value);\n		}\n		return w;\n	}\n	function parseLine(chunk) {\n		const words = [];\n		let box = null;\n		for (const f of readFields(chunk)) {\n			if (f.wire !== 2) continue;\n			if (f.field === 1) {\n				const w = parseWord(f.value);\n				if (w.text) words.push(w);\n			} else if (f.field === 2) box = parseGeometry(f.value) ?? box;\n		}\n		let text = \"\";\n		words.forEach((w, i) => {\n			text += w.text;\n			if (w.separator) text += w.separator;\n			else if (i < words.length - 1) text += \" \";\n		});\n		return {\n			text: text.replace(/\\s+/g, \" \").trim(),\n			words,\n			box\n		};\n	}\n	function parseParagraph(chunk) {\n		const p = {\n			lines: [],\n			box: null,\n			writing: null,\n			language: \"\"\n		};\n		for (const f of readFields(chunk)) if (f.field === 2 && f.wire === 2) {\n			const l = parseLine(f.value);\n			if (l.text) p.lines.push(l);\n		} else if (f.field === 3 && f.wire === 2) p.box = parseGeometry(f.value) ?? p.box;\n		else if (f.field === 4 && f.wire === 0) p.writing = f.value;\n		else if (f.field === 5 && f.wire === 2) p.language = utf8(f.value);\n		return p;\n	}\n	function parseText(chunk) {\n		const paragraphs = [];\n		let language = \"\";\n		for (const f of readFields(chunk)) if (f.field === 1 && f.wire === 2) {\n			for (const f2 of readFields(f.value)) if (f2.field === 1 && f2.wire === 2) paragraphs.push(parseParagraph(f2.value));\n		} else if (f.field === 2 && f.wire === 2) language = utf8(f.value);\n		if (!language && paragraphs.length) language = paragraphs[0].language;\n		return {\n			paragraphs,\n			language\n		};\n	}\n	/** ServerResponse{ 1: Error, 2: ObjectsResponse{ 3: Text } } */\n	function parseLensResponse(bytes) {\n		const res = {\n			language: \"\",\n			paragraphs: [],\n			error: null\n		};\n		for (const f of readFields(bytes)) {\n			if (f.wire !== 2) continue;\n			if (f.field === 1) try {\n				res.error = firstValues(f.value);\n			} catch {\n				res.error = {};\n			}\n			else if (f.field === 2) {\n				for (const f2 of readFields(f.value)) if (f2.field === 3 && f2.wire === 2) {\n					const t = parseText(f2.value);\n					if (t.paragraphs.length) res.paragraphs = t.paragraphs;\n					if (t.language) res.language = t.language;\n				}\n			}\n		}\n		return res;\n	}\n	/** Axis-aligned pixel box of a (possibly rotated) normalised centre box. */\n	function normBoxToPixels(b, width, height, scale = 1) {\n		const w = b.w * width;\n		const h = b.h * height;\n		const c = Math.abs(Math.cos(b.rotation));\n		const s = Math.abs(Math.sin(b.rotation));\n		const aw = w * c + h * s;\n		const ah = w * s + h * c;\n		return {\n			x: Math.round((b.cx * width - aw / 2) * scale),\n			y: Math.round((b.cy * height - ah / 2) * scale),\n			w: Math.max(1, Math.round(aw * scale)),\n			h: Math.max(1, Math.round(ah * scale))\n		};\n	}\n	/** Lens puts a space before punctuation (\"DATE ?!\") — undo that for Latin text. */\n	function cleanLensText(t) {\n		return t.replace(/\\s+([?!.,:;…）」』])/g, \"$1\").replace(/([（「『])\\s+/g, \"$1\").trim();\n	}\n	function lensLines(res, img) {\n		const out = [];\n		res.paragraphs.forEach((p, gi) => {\n			for (const l of p.lines) {\n				const nb = l.box ?? p.box;\n				if (!nb) continue;\n				const rot = nb.rotation;\n				const vertical = Math.abs(Math.abs(rot) - Math.PI / 2) < .5 || p.writing === 2;\n				const words = l.words.filter((w) => w.box).map((w) => ({\n					text: w.text,\n					box: normBoxToPixels(w.box, img.width, img.height, img.scale)\n				}));\n				out.push({\n					box: normBoxToPixels(nb, img.width, img.height, img.scale),\n					text: cleanLensText(l.text),\n					angle: rot,\n					vertical,\n					group: gi,\n					words: words.length === l.words.length ? words : void 0\n				});\n			}\n		});\n		return out;\n	}\n	async function lensOcr(img, opts = {}) {\n		if (img.bytes.byteLength > MAX_BYTES) throw new ProviderError(`image too large for Lens (${img.bytes.byteLength} bytes)`, \"lens\");\n		const body = buildLensRequest(img.bytes, img.width, img.height);\n		const r = await gmRequest({\n			url: LENS_ENDPOINT,\n			method: \"POST\",\n			headers: {\n				\"Content-Type\": \"application/x-protobuf\",\n				\"X-Goog-Api-Key\": LENS_API_KEY,\n				Accept: \"*/*\"\n			},\n			body,\n			signal: opts.signal,\n			timeoutMs: 4e4\n		});\n		if (r.status === 429 || r.status === 403) throw new ProviderError(`Lens HTTP ${r.status}`, \"lens\", r.status, true);\n		if (r.status < 200 || r.status >= 300) throw new ProviderError(`Lens HTTP ${r.status}`, \"lens\", r.status);\n		const raw = parseLensResponse(new Uint8Array(r.body));\n		return {\n			lines: lensLines(raw, img),\n			language: raw.language,\n			raw\n		};\n	}\n	//#endregion\n	//#region src/providers/papago.ts\n	const td = new TextDecoder();\n	const ENDPOINT = \"https://papago.naver.com/api/text/translation\";\n	const MAX_CHARS = 4500;\n	const LANG = {\n		ko: \"ko\",\n		en: \"en\",\n		ja: \"ja\",\n		zh: \"zh-CN\",\n		\"zh-CN\": \"zh-CN\",\n		\"zh-TW\": \"zh-TW\",\n		vi: \"vi\",\n		id: \"id\",\n		th: \"th\",\n		de: \"de\",\n		ru: \"ru\",\n		es: \"es\",\n		it: \"it\",\n		fr: \"fr\",\n		hi: \"hi\",\n		pt: \"pt\",\n		auto: \"auto\"\n	};\n	function papagoSupports(sl, tl) {\n		return !!LANG[tl] && tl !== \"auto\" && (sl === \"auto\" || !!LANG[sl]);\n	}\n	async function request(text, sl, tl, opts) {\n		const form = new URLSearchParams();\n		form.set(\"source\", LANG[sl] ?? \"auto\");\n		form.set(\"target\", LANG[tl]);\n		form.set(\"text\", text);\n		form.set(\"dict\", \"false\");\n		form.set(\"useGlossary\", \"false\");\n		form.set(\"honorific\", opts.honorific ? \"true\" : \"false\");\n		const r = await gmRequest({\n			url: ENDPOINT,\n			method: \"POST\",\n			headers: {\n				\"Content-Type\": \"application/x-www-form-urlencoded; charset=UTF-8\",\n				Accept: \"application/json\",\n				Origin: \"https://papago.naver.com\",\n				Referer: \"https://papago.naver.com/\"\n			},\n			body: form.toString(),\n			signal: opts.signal,\n			timeoutMs: 2e4\n		});\n		if (r.status === 429 || r.status === 403) throw new ProviderError(`papago HTTP ${r.status}`, \"papago\", r.status, true);\n		if (r.status !== 200) throw new ProviderError(`papago HTTP ${r.status}`, \"papago\", r.status);\n		let data;\n		try {\n			data = JSON.parse(td.decode(r.body));\n		} catch {\n			throw new ProviderError(\"papago: non-JSON response\", \"papago\");\n		}\n		if (typeof data?.translatedText !== \"string\") throw new ProviderError(`papago: ${data?.errorMessage ?? \"no translatedText\"}`, \"papago\");\n		return data.translatedText;\n	}\n	/** Translate `texts` (one per block) with as few requests as possible; line count is verified and mismatches are re-sent in halves. */\n	async function papagoTranslate(texts, sl, tl, opts = {}) {\n		if (!texts.length) return [];\n		if (!papagoSupports(sl, tl)) throw new ProviderError(`papago: unsupported pair ${sl}→${tl}`, \"papago\", 400, true);\n		const clean = texts.map((t) => t.replace(/\\s*\\n\\s*/g, \" \").trim());\n		const out = new Array(clean.length).fill(\"\");\n		const run = async (idx) => {\n			const nonEmpty = idx.filter((i) => clean[i]);\n			if (!nonEmpty.length) return;\n			const joined = nonEmpty.map((i) => clean[i]).join(\"\\n\");\n			if (joined.length > MAX_CHARS && nonEmpty.length > 1) {\n				const mid = nonEmpty.length >> 1;\n				await run(nonEmpty.slice(0, mid));\n				await run(nonEmpty.slice(mid));\n				return;\n			}\n			const res = (await request(joined, sl, tl, opts)).split(\"\\n\");\n			if (res.length === nonEmpty.length) {\n				nonEmpty.forEach((i, k) => out[i] = res[k].trim());\n				return;\n			}\n			if (nonEmpty.length === 1) {\n				out[nonEmpty[0]] = res.join(\" \").trim();\n				return;\n			}\n			const mid = nonEmpty.length >> 1;\n			await run(nonEmpty.slice(0, mid));\n			await run(nonEmpty.slice(mid));\n		};\n		await run(clean.map((_, i) => i));\n		return out;\n	}\n	//#endregion\n	//#region src/providers/registry.ts\n	/** The ordered list of translators to try for this language pair. */\n	function translateChain(s, sl, tl) {\n		const jaKo = sl === \"ja\" && tl === \"ko\";\n		const chain = s.stages.translate.filter((id) => {\n			if (id === \"gemini-text\") return !!s.keys.gemini;\n			if (id === \"papago\") return papagoSupports(sl, tl);\n			if (id === \"deepl\") return deeplSupports(sl, tl);\n			if (id === \"google-unofficial\") return !jaKo || s.stages.googleForJaKo;\n			return false;\n		});\n		if (!chain.includes(\"google-unofficial\") && s.stages.translate.includes(\"google-unofficial\")) chain.push(\"google-unofficial\");\n		return chain;\n	}\n	function geminiModels(s) {\n		return [s.gemini.model, ...s.gemini.fallbackModels.filter((m) => m !== s.gemini.model)];\n	}\n	async function runOneshot(img, ctx, s, signal, log) {\n		if (s.stages.oneshot !== \"gemini-oneshot\") throw new ProviderError(`unknown oneshot provider ${s.stages.oneshot}`, \"registry\");\n		if (!s.keys.gemini) throw new ProviderError(\"Gemini API key missing\", \"gemini\", 401, true);\n		let last;\n		for (const model of geminiModels(s)) {\n			const id = `gemini:${model}`;\n			if (limiter.isCoolingDown(id)) {\n				log(`skip ${id} (cooldown ${Math.round(limiter.cooldownRemaining(id) / 1e3)}s)`);\n				continue;\n			}\n			try {\n				await limiter.acquire(\"gemini\", signal);\n				return {\n					regions: await geminiOneshot(img, ctx, {\n						key: s.keys.gemini,\n						model,\n						signal,\n						includeSfx: s.stages.sfx\n					}),\n					provider: id\n				};\n			} catch (e) {\n				last = e;\n				if (e instanceof ProviderError && e.terminal) {\n					limiter.reportTerminal(id);\n					log(`${id} terminal: ${e.message}`);\n					if (e.status === 400 || e.status === 401) throw e;\n					continue;\n				}\n				if (e?.name === \"AbortError\") throw e;\n				log(`${id} failed: ${e.message}`);\n			}\n		}\n		throw last instanceof Error ? last : new ProviderError(\"all Gemini models failed\", \"gemini\");\n	}\n	async function runOcr(img, s, signal, log) {\n		if (s.stages.ocr !== \"lens\") throw new ProviderError(`unknown OCR provider ${s.stages.ocr}`, \"registry\");\n		await limiter.acquire(\"lens\", signal);\n		try {\n			const r = await lensOcr(img, { signal });\n			return {\n				lines: r.lines,\n				language: r.language,\n				provider: \"lens\"\n			};\n		} catch (e) {\n			if (e instanceof ProviderError && e.terminal) limiter.reportTerminal(\"lens\");\n			throw e;\n		}\n	}\n	async function runTranslate(texts, ctx, s, signal, log) {\n		if (!texts.length) return {\n			dst: [],\n			provider: \"none\"\n		};\n		const chain = translateChain(s, ctx.sourceLang, ctx.targetLang);\n		let last;\n		for (const id of chain) try {\n			if (id === \"gemini-text\") for (const model of geminiModels(s)) {\n				const mid = `gemini:${model}`;\n				if (limiter.isCoolingDown(mid)) continue;\n				try {\n					await limiter.acquire(\"gemini\", signal);\n					return {\n						dst: await geminiTranslate(texts, ctx, {\n							key: s.keys.gemini,\n							model,\n							signal\n						}),\n						provider: mid\n					};\n				} catch (e) {\n					last = e;\n					if (e instanceof ProviderError && e.terminal) limiter.reportTerminal(mid);\n					if (e?.name === \"AbortError\") throw e;\n					log(`${mid} translate failed: ${e.message}`);\n				}\n			}\n			else {\n				if (limiter.isCoolingDown(id)) throw new ProviderError(`${id} cooling down`, id, 429, true);\n				await limiter.acquire(id, signal);\n				return {\n					dst: id === \"papago\" ? await papagoTranslate(texts, ctx.sourceLang, ctx.targetLang, { signal }) : id === \"deepl\" ? await deeplTranslate(texts, ctx.sourceLang, ctx.targetLang, signal) : await googleTranslate(texts, ctx.sourceLang, ctx.targetLang, signal),\n					provider: id\n				};\n			}\n		} catch (e) {\n			last = e;\n			if (e instanceof ProviderError && e.terminal) limiter.reportTerminal(id);\n			if (e?.name === \"AbortError\") throw e;\n			log(`${id} failed: ${e.message}`);\n		}\n		throw last instanceof Error ? last : new ProviderError(\"all translators failed\", \"registry\");\n	}\n	//#endregion\n	//#region src/core/pipeline.ts\n	const breathe = () => new Promise((r) => setTimeout(r, 0));\n	const LANG_FROM_LENS = {\n		ja: \"ja\",\n		ko: \"ko\",\n		en: \"en\",\n		zh: \"zh\",\n		\"zh-Hans\": \"zh\",\n		\"zh-Hant\": \"zh\"\n	};\n	async function translatePage(input) {\n		const { bytes, settings: s, raster, signal } = input;\n		const log = input.log ?? (() => void 0);\n		const t = {};\n		const mark = (k, from) => t[k] = Math.round(performance.now() - from);\n		let t0 = performance.now();\n		const img = await raster.decode(bytes);\n		mark(\"decode\", t0);\n		t0 = performance.now();\n		const upload = await prepareUpload(raster, img, s.gemini.maxSide);\n		mark(\"encodeUpload\", t0);\n		const canvas = raster.createCanvas(img.width, img.height);\n		const c2d = canvas.getContext(\"2d\", { willReadFrequently: true });\n		c2d.drawImage(img.source, 0, 0);\n		img.close?.();\n		const id = c2d.getImageData(0, 0, img.width, img.height);\n		const rasterData = {\n			data: id.data,\n			width: id.width,\n			height: id.height\n		};\n		const gapClear = (band) => bandIsClear(rasterData, band);\n		const ctx = { ...input.ctx };\n		let regions = [];\n		let provider = \"\";\n		let sourceLang = ctx.sourceLang;\n		let useOneshot = !!s.stages.oneshot && !!s.keys.gemini;\n		if (useOneshot) {\n			t0 = performance.now();\n			try {\n				const r = await runOneshot(upload, ctx, s, signal, log);\n				regions = r.regions;\n				if (s.stages.ruby !== \"off\") regions.forEach(parseInlineRuby);\n				else regions.forEach((r) => r.dst = r.dst.replace(/⟨[^⟨⟩]*⟩/g, \"\"));\n				provider = r.provider;\n				mark(\"oneshot\", t0);\n			} catch (e) {\n				if (e?.name === \"AbortError\") throw e;\n				log(`oneshot failed → falling back to OCR + translate: ${e.message}`);\n				useOneshot = false;\n			}\n		}\n		if (!useOneshot) {\n			t0 = performance.now();\n			const ocr = await runOcr(upload, s, signal, log);\n			mark(\"ocr\", t0);\n			if (ctx.sourceLang === \"auto\" && ocr.language) ctx.sourceLang = LANG_FROM_LENS[ocr.language] ?? ocr.language;\n			sourceLang = ctx.sourceLang;\n			regions = sortReadingOrder(filterRegions(splitOverlapping(mergeLines(handleFurigana(ocr.lines, s.stages.ruby === \"off\" ? \"off\" : \"on\"), { gapClear }), gapClear), img.width, img.height), ctx.sourceLang === \"ja\");\n			tagSfx(regions, (box) => ringIsFlat(rasterData, box));\n			if (!s.stages.sfx) regions = regions.filter((r) => r.kind !== \"sfx\");\n			t0 = performance.now();\n			if (regions.length) {\n				const rubyKeys = rubyTextsToTranslate(regions);\n				const tr = await runTranslate([...regions.map((r) => r.src), ...rubyKeys], ctx, s, signal, log);\n				const rubyTr = new Map(rubyKeys.map((k, i) => [k, tr.dst[regions.length + i] ?? \"\"]));\n				regions.forEach((r, i) => applyRuby(r, tr.dst[i] ?? \"\", rubyTr));\n				provider = `${ocr.provider}+${tr.provider}`;\n			} else provider = ocr.provider;\n			mark(\"translate\", t0);\n		}\n		regions = regions.filter((r) => r.src && r.dst && r.dst.trim() !== r.src.trim());\n		t0 = performance.now();\n		if (regions.length) {\n			for (const r of regions) {\n				r.layout = estimateLayoutRect(rasterData, r, eraseRegion(rasterData, r, { mode: s.stages.erase }));\n				if (input.cooperative) await breathe();\n			}\n			resolveLayoutOverlaps(regions);\n			c2d.putImageData(id, 0, 0);\n			mark(\"erase\", t0);\n			t0 = performance.now();\n			let plans = regions.map((r) => planRegion(c2d, r, s.render));\n			if (s.render.unifyFont) {\n				const sizes = plans.filter((p) => !!p).map((p) => p.layout.fontPx).sort((a, b) => a - b);\n				const base = sizes.length ? sizes[sizes.length >> 1] : 0;\n				if (base) plans = plans.map((p) => p && p.layout.fontPx > base ? planRegion(c2d, p.region, s.render, base) : p);\n			}\n			for (const p of plans) {\n				if (!p) continue;\n				const lay = drawPlan(c2d, p, s.render);\n				p.region.fontPx = lay.fontPx;\n				p.region.lineCount = lay.lines.length;\n			}\n			mark(\"render\", t0);\n		}\n		t0 = performance.now();\n		const outMime = input.outMime ?? \"image/jpeg\";\n		const out = await raster.encode(canvas, outMime, input.outQuality ?? .92);\n		mark(\"encode\", t0);\n		return {\n			regions,\n			width: img.width,\n			height: img.height,\n			out,\n			outMime,\n			provider,\n			sourceLang,\n			timings: t,\n			empty: regions.length === 0\n		};\n	}\n	//#endregion\n	//#region src/worker/pipeline.worker.ts\n	const post = (m, transfer) => self.postMessage(m, transfer ?? []);\n	const jobs = /* @__PURE__ */ new Map();\n	const xhrs = /* @__PURE__ */ new Map();\n	let xhrSeq = 0;\n	setTransport((req) => {\n		const { signal, ...rest } = req;\n		return new Promise((resolve, reject) => {\n			const id = ++xhrSeq;\n			xhrs.set(id, {\n				resolve,\n				reject\n			});\n			let body = rest.body;\n			if (body instanceof Uint8Array) body = body.slice().buffer;\n			post({\n				type: \"xhr\",\n				id,\n				req: {\n					...rest,\n					body\n				}\n			});\n			signal?.addEventListener(\"abort\", () => post({\n				type: \"xhr-abort\",\n				id\n			}), { once: true });\n		});\n	});\n	self.onmessage = async (e) => {\n		const m = e.data;\n		if (m.type === \"xhr-result\") {\n			const p = xhrs.get(m.id);\n			xhrs.delete(m.id);\n			if (!p) return;\n			if (m.ok) p.resolve(m.res);\n			else {\n				const err = m.name === \"AbortError\" ? new DOMException(m.message, \"AbortError\") : new Error(m.message);\n				p.reject(err);\n			}\n			return;\n		}\n		if (m.type === \"abort\") {\n			jobs.get(m.id)?.abort();\n			return;\n		}\n		if (m.type === \"run\") {\n			const ac = new AbortController();\n			jobs.set(m.id, ac);\n			try {\n				const out = await translatePage({\n					bytes: new Uint8Array(m.bytes),\n					settings: m.settings,\n					ctx: m.ctx,\n					raster: browserRaster,\n					signal: ac.signal,\n					log: (...a) => post({\n						type: \"log\",\n						id: m.id,\n						args: a.map((x) => typeof x === \"string\" ? x : JSON.stringify(x))\n					}),\n					outMime: m.outMime,\n					outQuality: m.outQuality\n				});\n				const buf = out.out.buffer.slice(out.out.byteOffset, out.out.byteOffset + out.out.byteLength);\n				post({\n					type: \"done\",\n					id: m.id,\n					out: {\n						...out,\n						out: buf\n					}\n				}, [buf]);\n			} catch (err) {\n				const er = err;\n				post({\n					type: \"error\",\n					id: m.id,\n					name: er?.name ?? \"Error\",\n					message: er?.message ?? String(err)\n				});\n			} finally {\n				jobs.delete(m.id);\n			}\n		}\n	};\n	post({ type: \"ready\" });\n	//#endregion\n})();\n";
	var blob = typeof self !== "undefined" && self.Blob && new Blob(["(self.URL || self.webkitURL).revokeObjectURL(self.location.href);", jsContent], { type: "text/javascript;charset=utf-8" });
	function WorkerWrapper(options) {
		let objURL;
		try {
			objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
			if (!objURL) throw "";
			const worker = new Worker(objURL, { name: options?.name });
			worker.addEventListener("error", () => {
				(self.URL || self.webkitURL).revokeObjectURL(objURL);
			});
			return worker;
		} catch (e) {
			return new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent), { name: options?.name });
		}
	}
	var PipelineClient = class {
		worker = null;
		ready = null;
		seq = 0;
		pending = new Map();
		xhrAborts = new Map();
		static supported() {
			return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
		}
		start() {
			if (this.ready) return this.ready;
			this.ready = new Promise((resolve) => {
				let w;
				try {
					w = new WorkerWrapper();
				} catch (e) {
					console.warn("[miri] worker unavailable, processing on the page thread", e);
					resolve(false);
					return;
				}
				const timer = setTimeout(() => {
					console.warn("[miri] worker did not start in time, processing on the page thread");
					w.terminate();
					resolve(false);
				}, 4e3);
				w.onerror = (ev) => {
					console.warn("[miri] worker error", ev.message ?? ev);
					if (this.worker !== w) {
						clearTimeout(timer);
						w.terminate();
						resolve(false);
					}
				};
				w.onmessage = (e) => {
					const m = e.data;
					if (m.type === "ready") {
						clearTimeout(timer);
						this.worker = w;
						resolve(true);
						return;
					}
					this.handle(m);
				};
			});
			return this.ready;
		}
		post(m, transfer) {
			this.worker?.postMessage(m, transfer ?? []);
		}
		handle(m) {
			switch (m.type) {
				case "xhr": {
					const ac = new AbortController();
					this.xhrAborts.set(m.id, ac);
					gmRequest({
						...m.req,
						signal: ac.signal
					}).then((res) => this.post({
						type: "xhr-result",
						id: m.id,
						ok: true,
						res
					}, res.body instanceof ArrayBuffer ? [res.body] : [])).catch((e) => this.post({
						type: "xhr-result",
						id: m.id,
						ok: false,
						name: e?.name,
						message: e?.message ?? String(e)
					})).finally(() => this.xhrAborts.delete(m.id));
					break;
				}
				case "xhr-abort":
					this.xhrAborts.get(m.id)?.abort();
					break;
				case "log":
					this.pending.get(m.id)?.log(m.args.join(" "));
					break;
				case "done": {
					const p = this.pending.get(m.id);
					this.pending.delete(m.id);
					p?.resolve({
						...m.out,
						out: new Uint8Array(m.out.out)
					});
					break;
				}
				case "error": {
					const p = this.pending.get(m.id);
					this.pending.delete(m.id);
					const err = m.name === "AbortError" ? new DOMException(m.message, "AbortError") : Object.assign(new Error(m.message), { name: m.name });
					p?.reject(err);
					break;
				}
			}
		}
		translate(input) {
			if (!this.worker) return Promise.reject(new Error("worker not started"));
			const id = ++this.seq;
			const log = input.log ?? (() => void 0);
			return new Promise((resolve, reject) => {
				this.pending.set(id, {
					resolve,
					reject,
					log
				});
				const buf = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength);
				this.post({
					type: "run",
					id,
					bytes: buf,
					settings: input.settings,
					ctx: input.ctx,
					outMime: input.outMime,
					outQuality: input.outQuality
				}, [buf]);
				input.signal?.addEventListener("abort", () => this.post({
					type: "abort",
					id
				}), { once: true });
			});
		}
	};
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
			row("루비(후리가나)", select(s.stages.ruby === "off" ? "off" : "on", [["on", "단어 위에 표시"], ["off", "제거"]], (v) => {
				s.stages.ruby = v;
				commit(true);
			}), "가타카나·한자 루비는 번역해서, 외국어 루비는 그대로 해당 단어 위에 작게 표시합니다. 히라가나만인 루비(읽기 표기)는 항상 지웁니다");
			row("최소 글자", select(String(s.render.floorRatio), [
				["0.012", "작게 (페이지 너비의 1.2%)"],
				["0.015", "보통 (1.5%)"],
				["0.018", "크게 (1.8%)"],
				["0", "제한 없음 (말풍선에 맞춤)"]
			], (v) => {
				s.render.floorRatio = parseFloat(v) || 0;
				commit(true);
			}), "이보다 작아지면 글자 단위로 줄을 바꾸고, 그래도 안 되면 말풍선 밖으로 조금 키웁니다");
			row("글자 크기 통일", checkbox(s.render.unifyFont, (v) => {
				s.render.unifyFont = v;
				commit(true);
			}), "한 페이지의 말풍선 글자 크기를 중앙값에 맞춰 고르게 합니다(큰 말풍선만 작아짐)");
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
			mk("번역 복사", false, async () => {
				const n = await this.cb.onCopyTranslations();
				this.setStatus(n ? {
					state: "idle",
					text: `번역 ${n}건을 복사했습니다`
				} : {
					state: "idle",
					text: "복사할 번역이 없습니다"
				});
			});
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
	var ADAPTERS = [kHentaiAdapter, genericAdapter];
	function platform() {
		const ua = navigator.userAgent;
		if (/Android/i.test(ua)) return "android";
		if (/iPhone|iPad|iPod/i.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return "ios";
		return "desktop";
	}
	async function main() {
		const adapter = ADAPTERS.find((a) => a.matches(location));
		if (!adapter) return;
		const host = location.hostname;
		if (adapter.isEnabled && !await adapter.isEnabled(location)) {
			gmMenu(`MiriTranslator: 이 사이트(${host}) 번역 켜기`, () => {
				setSiteEnabled(host, true).then(() => location.reload());
			});
			return;
		}
		const session = await adapter.init();
		if (!session) {
			console.warn("[miri] adapter could not read the page");
			return;
		}
		if (adapter.isEnabled) gmMenu("MiriTranslator: 이 사이트 번역 끄기", () => {
			setSiteEnabled(host, false).then(() => location.reload());
		});
		let settings = await loadSettings();
		const log = (...a) => settings.debug && console.log("[miri]", ...a);
		const plat = platform();
		const client = PipelineClient.supported() ? new PipelineClient() : null;
		const useWorker = client ? await client.start() : false;
		const runPipeline = (input) => useWorker && client ? client.translate(input) : translatePage({
			...input,
			raster: browserRaster,
			cooperative: true
		});
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
		const notImage = () => Object.assign(new Error("이미지 아님 (핫링크 차단?)"), { name: "NotImage" });
		const assertImage = (bytes) => {
			if (bytes.byteLength < 100 || sniffMime(bytes) === "application/octet-stream") throw notImage();
		};
		const bytesFromElement = async (el) => {
			if (!el || !el.naturalWidth || !el.naturalHeight) return null;
			try {
				const c = document.createElement("canvas");
				c.width = el.naturalWidth;
				c.height = el.naturalHeight;
				c.getContext("2d").drawImage(el, 0, 0);
				const blob = await new Promise((res) => c.toBlob(res, "image/png"));
				if (!blob) return null;
				return new Uint8Array(await blob.arrayBuffer());
			} catch {
				return null;
			}
		};
		const fetchBytes = async (page, signal, el) => {
			if (page.url.startsWith("blob:")) {
				const px = await bytesFromElement(el);
				if (px) return px;
				throw new Error("blob 이미지를 읽을 수 없음 (아직 로드되지 않음)");
			}
			try {
				const r = await gmRequest({
					url: page.url,
					method: "GET",
					headers: {
						...session.referer ? { Referer: session.referer } : {},
						Origin: location.origin
					},
					signal,
					anonymous: false,
					timeoutMs: 6e4
				});
				if (r.status < 200 || r.status >= 300) throw new Error(`image HTTP ${r.status}`);
				const bytes = new Uint8Array(r.body);
				assertImage(bytes);
				return bytes;
			} catch (e) {
				const px = await bytesFromElement(el);
				if (px) {
					log(`page ${page.index}: network fetch failed (${e.message}) → read pixels from the <img>`);
					return px;
				}
				throw e;
			}
		};
		const applyCached = (index, cached) => {
			const url = URL.createObjectURL(cached.blob);
			results.set(index, {
				url,
				regions: cached.regions,
				provider: cached.provider,
				fromCache: true
			});
			histories.set(index, cached.regions.map((r) => ({
				src: r.src,
				dst: r.dst
			})));
			applyAll();
		};
		const processPage = async (page, signal) => {
			if (!settings.enabled) return;
			if (results.has(page.index)) return;
			const sig = settingsSignature(settings);
			const knownKey = await pageCache.getKey(page.url, sig);
			if (knownKey) {
				const cached = await pageCache.get(knownKey);
				if (cached) {
					applyCached(page.index, cached);
					log(`page ${page.index}: cache hit (url index, no download)`);
					return;
				}
			}
			const tFetch = performance.now();
			const el = session.imageElements().get(page.index) ?? null;
			const bytes = await fetchBytes(page, signal, el);
			const fetchMs = Math.round(performance.now() - tFetch);
			const key = `${await sha1Hex(bytes)}|${sig}`;
			const cached = await pageCache.get(key);
			if (cached) {
				pageCache.setKey(page.url, key);
				applyCached(page.index, cached);
				log(`page ${page.index}: cache hit (fetch ${fetchMs}ms, ${Math.round(bytes.length / 1024)} kB)`);
				return;
			}
			const out = await runPipeline({
				bytes,
				ctx: contextFor(page.index),
				settings,
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
			pageCache.setKey(page.url, key);
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
		session.onImagesChanged(() => {
			scheduler.setPages(session.pages);
			scheduler.pump();
			applyAll();
		});
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
		document.addEventListener("keydown", (e) => {
			if (e.key !== "`" || e.ctrlKey || e.metaKey || e.altKey) return;
			const tgt = e.target;
			if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName || ""))) return;
			e.preventDefault();
			showOriginal = !showOriginal;
			applyAll();
		});
		const copyTranslations = async () => {
			const lines = [];
			for (const i of [...results.keys()].sort((a, b) => a - b)) {
				const res = results.get(i);
				if (!res) continue;
				for (const r of res.regions) {
					const src = (r.src ?? "").trim();
					const dst = (r.dst ?? "").trim();
					if (!dst || dst === src) continue;
					lines.push(src ? `${src} → ${dst}` : dst);
				}
			}
			if (!lines.length) return 0;
			const text = lines.join("\n");
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.cssText = "position:fixed;top:-9999px";
				document.body.appendChild(ta);
				ta.select();
				try {
					document.execCommand("copy");
				} finally {
					ta.remove();
				}
			}
			return lines.length;
		};
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
			onClearCache: () => pageCache.clear(),
			onCopyTranslations: () => copyTranslations()
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
		if (settings.enabled && session.pages.length === 0) status("idle", "이미지를 찾는 중 — 페이지 이미지가 나타나면 번역을 시작합니다");
		else {
			status(settings.enabled ? "working" : "off", `시작: ${session.pages.length}페이지, 원문 ${ctx.sourceLang}`);
			scheduler.pump();
		}
		log("session", session.chapterId, session.pages.length, "pages, lang", session.sourceLang, "platform", plat, useWorker ? "worker" : "main-thread");
	}
	main().catch((e) => console.error("[miri] fatal", e));
})();
