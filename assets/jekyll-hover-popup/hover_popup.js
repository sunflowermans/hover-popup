(function () {
  "use strict";

  const config = window.__JHP_CONFIG__ || {};
  const HOVER_DELAY_MS = Number(config.hoverDelayMs) || 0;
  const NAV_HOVER_PREVIEW = config.navHoverPreview !== false;
  const TRANSIENT_TITLE_HINT = "SHIFT to persist";
  const MAX_VIEWPORT_WIDTH = 0.92;
  const MAX_VIEWPORT_HEIGHT = 0.92;
  const MIN_WIDTH = 150;
  const MIN_HEIGHT = 80;
  const BAR_HEIGHT = 20;
  const GAP = 10;

  const DRAG_NONE = 0;
  const DRAG_MOVE = 1;
  const DRAG_N = 2;
  const DRAG_NE = 3;
  const DRAG_E = 4;
  const DRAG_SE = 5;
  const DRAG_S = 6;
  const DRAG_SW = 7;
  const DRAG_W = 8;
  const DRAG_NW = 9;

  const pageCache = new Map();
  const linkMeta = new WeakMap();
  const persistentUrls = new Set();
  const tempAnchors = new Set();
  const openWindows = new Map();
  let nextWindowId = 0;
  let nextZIndex = 10000;

  function readStyle(el, prop) {
    if (!el) return "";
    return getComputedStyle(el).getPropertyValue(prop);
  }

  function syncThemeVars() {
    const root = document.documentElement;
    const body = document.body;
    const main = document.querySelector("#main-content main") || document.querySelector("main");
    const sidebar = document.querySelector(".side-bar");
    const link = document.querySelector("#main-content a[href], main a[href], .site-nav a[href]");
    const blockquote = document.querySelector("#main-content blockquote, main blockquote");
    const code = document.querySelector("#main-content code, main code");

    const bodyStyle = body ? getComputedStyle(body) : null;
    const mainStyle = main ? getComputedStyle(main) : bodyStyle;
    const sidebarStyle = sidebar ? getComputedStyle(sidebar) : bodyStyle;
    const linkStyle = link ? getComputedStyle(link) : null;
    const blockquoteStyle = blockquote ? getComputedStyle(blockquote) : null;
    const codeStyle = code ? getComputedStyle(code) : null;

    const set = (name, value) => {
      if (value) root.style.setProperty(name, value);
    };

    set("--jhp-body-bg", bodyStyle?.backgroundColor);
    set("--jhp-body-color", mainStyle?.color || bodyStyle?.color);
    set("--jhp-header-bg", sidebarStyle?.backgroundColor || bodyStyle?.backgroundColor);
    set("--jhp-link-color", linkStyle?.color);
    set(
      "--jhp-border-color",
      blockquoteStyle?.borderLeftColor ||
        codeStyle?.borderColor ||
        (bodyStyle?.color ? `color-mix(in srgb, ${bodyStyle.color} 18%, transparent)` : "")
    );
    set(
      "--jhp-shadow-color",
      bodyStyle?.color ? `color-mix(in srgb, ${bodyStyle.color} 28%, transparent)` : ""
    );
    set(
      "--jhp-accent-hover",
      bodyStyle?.color ? `color-mix(in srgb, ${bodyStyle.color} 10%, transparent)` : ""
    );
    set("--jhp-font-family", mainStyle?.fontFamily || bodyStyle?.fontFamily);
    set("--jhp-font-size", mainStyle?.fontSize || bodyStyle?.fontSize);
    set("--jhp-line-height", mainStyle?.lineHeight || bodyStyle?.lineHeight);

    const colorScheme = readStyle(body, "color-scheme") || readStyle(root, "color-scheme");
    if (colorScheme) root.style.colorScheme = colorScheme.trim();
  }

  function getClientX(evt) {
    if (evt.touches && evt.touches.length) return evt.touches[0].clientX;
    return evt.clientX;
  }

  function getClientY(evt) {
    if (evt.touches && evt.touches.length) return evt.touches[0].clientY;
    return evt.clientY;
  }

  function resolveUrl(href) {
    return new URL(href, window.location.href);
  }

  function resolveUrlAgainst(href, basePageUrl) {
    const base = basePageUrl.startsWith("http")
      ? basePageUrl
      : new URL(basePageUrl, window.location.origin).href;
    return new URL(href, base);
  }

  function isDiceTrayLink(anchor) {
    if (!anchor) return false;
    return anchor.classList.contains("dice-tray-roll") || anchor.hasAttribute("data-dice");
  }

  function rewriteContentLinks(content, basePageUrl) {
    if (!content || !basePageUrl) return;

    content.querySelectorAll("a[href]").forEach((anchor) => {
      if (anchor.closest(".jhp-hwin__actions")) return;
      if (isDiceTrayLink(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("mailto:") || href.startsWith("javascript:")) return;

      try {
        const resolved = resolveUrlAgainst(href, basePageUrl);
        if (resolved.origin !== window.location.origin) return;
        anchor.setAttribute("href", resolved.pathname + resolved.search + resolved.hash);
      } catch {
        /* ignore malformed href */
      }
    });
  }

  function normalizePath(pathname) {
    if (!pathname) return "/";
    const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
    return normalized;
  }

  function normalizeLinkKey(url) {
    return normalizePath(url.pathname) + url.search + url.hash;
  }

  function isSamePage(url) {
    return (
      normalizePath(url.pathname) === normalizePath(window.location.pathname) &&
      url.search === window.location.search
    );
  }

  function isImagePath(pathname) {
    return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(pathname);
  }

  function isImageLink(anchor, url) {
    if (isImagePath(url.pathname)) return true;
    return !!anchor.querySelector("img[src]");
  }

  // don't show preview for links inside a navigation element
  function isNavLink(anchor) {
    return !!anchor.closest("nav, .site-nav, .nav-list, [role='navigation']");
  }

  // don't show preview for heading permalinks
  function isHeadingPermalink(anchor) {
    if (!anchor) return false;
    if (anchor.classList.contains("anchor-heading")) return true;
    const use = anchor.querySelector("use");
    if (!use) return false;
    const ref = use.getAttribute("href") || use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    return ref === "#svg-link";
  }

  function isInternalPageLink(anchor) {
    if (!anchor || anchor.closest(".jhp-hwin__actions")) return false;
    if (isDiceTrayLink(anchor)) return false;
    if (isHeadingPermalink(anchor)) return false;
    if (!NAV_HOVER_PREVIEW && isNavLink(anchor)) return false;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("javascript:")) return false;

    let url;
    try {
      url = resolveUrl(href);
    } catch {
      return false;
    }

    if (url.origin !== window.location.origin) return false;
    if (url.pathname.endsWith(".pdf") || url.pathname.endsWith(".zip")) return false;

    if (isImageLink(anchor, url)) return false;

    if (isSamePage(url)) return !!url.hash;
    if (url.hash) return true;
    return !!url.pathname;
  }

  function getMainContent(doc) {
    return doc.querySelector("#main-content main") || doc.querySelector("main");
  }

  function headingLevel(node) {
    const match = node.tagName && node.tagName.match(/^H([1-6])$/);
    return match ? Number(match[1]) : null;
  }

  // Preview shows to the end of the callout section
  // not to the beginning of the next parent header
  const CALLOUT_BOUNDARY_SELECTOR =
    "blockquote[id], div[id], section[id], article[id], aside[id], details[id], li[id], p[id], table[id], dl[id], figure[id], pre[id]";

  function isCalloutBoundary(el) {
    if (!el || !el.id) return false;
    if (el.tagName === "A") return false;
    if (headingLevel(el) != null) return true;
    return /^(BLOCKQUOTE|DIV|SECTION|ARTICLE|ASIDE|DETAILS|LI|P|TABLE|DL|FIGURE|PRE)$/i.test(el.tagName);
  }

  function isSectionBoundary(el) {
    if (!el || !el.id) return false;
    if (el.tagName === "A") return true;
    return isCalloutBoundary(el);
  }

  function findCalloutRoot(el) {
    if (!el) return null;
    if (isCalloutBoundary(el)) return el;
    const callout = el.closest(CALLOUT_BOUNDARY_SELECTOR);
    return callout && isCalloutBoundary(callout) ? callout : null;
  }

  function findSectionRoot(el) {
    if (!el) return null;
    if (headingLevel(el) != null) return el;
    const callout = findCalloutRoot(el);
    if (callout) return callout;
    const heading = el.closest("h1,h2,h3,h4,h5,h6");
    return heading || el;
  }

  function cloneSectionFromRoot(root, doc) {
    const wrapper = doc.createElement("div");
    wrapper.className = "jhp-section";

    const level = headingLevel(root);
    const isIdSection = level == null && !!root.id;
    wrapper.appendChild(root.cloneNode(true));

    let sibling = root.nextElementSibling;
    while (sibling) {
      const siblingLevel = headingLevel(sibling);
      if (level != null && siblingLevel != null && siblingLevel <= level) break;
      if (level == null && siblingLevel != null) break;
      if (isIdSection && isSectionBoundary(sibling)) break;
      wrapper.appendChild(sibling.cloneNode(true));
      sibling = sibling.nextElementSibling;
    }

    return wrapper;
  }

  function extractContent(doc, hash) {
    const main = getMainContent(doc);
    if (!main) return null;

    if (!hash) {
      const clone = main.cloneNode(true);
      clone.querySelectorAll(".site-nav, .toc, #toc, .child-nav").forEach((el) => el.remove());
      return clone;
    }

    const id = decodeURIComponent(hash.slice(1));
    let target = doc.getElementById(id);
    if (!target) {
      target = doc.querySelector(`a.anchor[name="${CSS.escape(id)}"]`);
    }
    if (!target) return null;

    const root = findSectionRoot(target);
    return cloneSectionFromRoot(root, doc);
  }

  async function fetchPageDocument(pathname) {
    const cacheKey = pathname.endsWith("/") ? pathname : `${pathname}/`;
    if (pageCache.has(cacheKey)) return pageCache.get(cacheKey);

    const fetchPath = cacheKey;
    const response = await fetch(fetchPath, { credentials: "same-origin" });
    if (!response.ok) {
      const fallback = pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`;
      if (fallback !== fetchPath) {
        const retry = await fetch(fallback, { credentials: "same-origin" });
        if (retry.ok) {
          const html = await retry.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          pageCache.set(cacheKey, doc);
          pageCache.set(fallback, doc);
          return doc;
        }
      }
      throw new Error(`Failed to load ${fetchPath}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    pageCache.set(cacheKey, doc);
    return doc;
  }

  async function loadLinkContent(anchor) {
    const url = resolveUrl(anchor.href);
    const hash = url.hash;

    let doc;
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      doc = document;
    } else {
      doc = await fetchPageDocument(url.pathname);
    }

    const content = extractContent(doc, hash);
    if (!content) throw new Error("Section not found");

    const titleNode = content.querySelector("h1,h2,h3,h4,h5,h6");
    const title = titleNode ? titleNode.textContent.trim() : anchor.textContent.trim() || url.pathname;
    const pageUrl = url.pathname + url.search + url.hash;

    rewriteContentLinks(content, pageUrl);

    return {
      content,
      title,
      pageUrl,
    };
  }

  function cleanTempWindows(exceptAnchor) {
    for (const anchor of tempAnchors) {
      if (anchor === exceptAnchor) continue;
      const meta = linkMeta.get(anchor);
      if (!meta || meta.isPermanent) continue;
      meta.isHovered = false;
      clearTimeout(meta.hoverTimer);
      if (meta.windowMeta) {
        meta.windowMeta.close();
        meta.windowMeta = null;
      }
      tempAnchors.delete(anchor);
    }
  }

  function closeAllWindows() {
    openWindows.forEach((win) => win.close());
    openWindows.clear();
    persistentUrls.clear();
  }

  function getPositionFromEvent(evt, anchor) {
    const bcr = anchor.getBoundingClientRect();
    return {
      isFromBottom: bcr.top > window.innerHeight / 2,
      isFromRight: bcr.left > window.innerWidth / 2,
      clientX: getClientX(evt),
      bcr,
      isPreventFlicker: true,
    };
  }

  function getPositionFromPoint(clientX, clientY) {
    const bcr = {
      top: clientY,
      left: clientX,
      bottom: clientY + 1,
      right: clientX + 1,
      height: 1,
      width: 1,
    };
    return {
      isFromBottom: clientY > window.innerHeight / 2,
      isFromRight: clientX > window.innerWidth / 2,
      clientX,
      bcr,
      isPreventFlicker: true,
    };
  }

  function setWindowPosition(winEl, contentEl, position) {
    const rect = winEl.getBoundingClientRect();
    const width = rect.width || winEl.offsetWidth || MIN_WIDTH;

    let top;
    if (position.isFromBottom) {
      top = position.bcr.top - rect.height - GAP;
    } else {
      top = position.bcr.top + position.bcr.height + GAP;
    }

    let left;
    if (position.isFromRight) {
      left = (position.clientX || position.bcr.left) - width - GAP;
    } else {
      left = (position.clientX || position.bcr.left + position.bcr.width) + GAP;
    }

    winEl.style.top = `${Math.max(0, top)}px`;
    winEl.style.left = `${Math.max(0, left)}px`;

    adjustWindowToViewport(winEl, contentEl, position);
  }

  function adjustWindowToViewport(winEl, contentEl, position) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    let rect = winEl.getBoundingClientRect();

    if (rect.left < 0) {
      winEl.style.left = "0px";
    } else if (rect.right > screenW) {
      winEl.style.left = `${Math.max(0, screenW - rect.width - 8)}px`;
    }

    rect = winEl.getBoundingClientRect();
    if (rect.top < 0) {
      winEl.style.top = "0px";
    } else if (rect.bottom > screenH) {
      winEl.style.top = `${Math.max(0, screenH - rect.height - 8)}px`;
    }

    if (position && position.isPreventFlicker && position.bcr) {
      rect = winEl.getBoundingClientRect();
      const overlap =
        rect.left < position.bcr.right &&
        rect.right > position.bcr.left &&
        rect.top < position.bcr.bottom &&
        rect.bottom > position.bcr.top;

      if (overlap) {
        const available = position.isFromBottom
          ? position.bcr.top - GAP
          : screenH - position.bcr.bottom - GAP - BAR_HEIGHT;
        contentEl.style.maxHeight = `${Math.max(MIN_HEIGHT, available)}px`;
      }
    }
  }

  function fitWindowToContent(winEl, contentEl) {
    contentEl.style.height = "";
    contentEl.style.maxHeight = `${Math.floor(window.innerHeight * MAX_VIEWPORT_HEIGHT) - BAR_HEIGHT}px`;

    const img = contentEl.querySelector("img");
    let contentWidth = contentEl.scrollWidth;
    if (img && img.naturalWidth) {
      contentWidth = Math.max(contentWidth, img.naturalWidth);
    }

    const targetWidth = Math.min(
      Math.max(contentWidth + 24, MIN_WIDTH),
      Math.floor(window.innerWidth * MAX_VIEWPORT_WIDTH)
    );
    winEl.style.width = `${targetWidth}px`;

    let naturalHeight = contentEl.scrollHeight;
    if (img && img.naturalHeight) {
      naturalHeight = Math.max(naturalHeight, img.naturalHeight);
    }

    const maxContentHeight = Math.floor(window.innerHeight * MAX_VIEWPORT_HEIGHT) - BAR_HEIGHT;
    contentEl.style.maxHeight = `${Math.min(naturalHeight, maxContentHeight)}px`;
  }

  function addResizeHandle(winEl, className, type, onBegin) {
    const handle = document.createElement("div");
    handle.className = `jhp-resize ${className}`;
    handle.addEventListener("mousedown", (evt) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      onBegin(evt, type);
    });
    winEl.appendChild(handle);
    return handle;
  }

  function setupWindowInteraction(winEl, header, contentEl, windowMeta) {
    const drag = {
      type: DRAG_NONE,
      startX: 0,
      startY: 0,
      baseTop: 0,
      baseLeft: 0,
      baseWidth: 0,
      baseHeight: 0,
    };

    function beginInteraction(evt, type) {
      drag.type = type;
      drag.startX = getClientX(evt);
      drag.startY = getClientY(evt);
      drag.baseTop = parseFloat(winEl.style.top) || winEl.getBoundingClientRect().top;
      drag.baseLeft = parseFloat(winEl.style.left) || winEl.getBoundingClientRect().left;
      drag.baseWidth = winEl.offsetWidth;
      drag.baseHeight = contentEl.offsetHeight;

      if (type !== DRAG_MOVE) {
        contentEl.style.maxHeight = "none";
        contentEl.style.height = `${drag.baseHeight}px`;
        winEl.style.maxWidth = "none";
      }

      winEl.style.zIndex = String(++nextZIndex);
      document.addEventListener("mousemove", onPointerMove);
      document.addEventListener("mouseup", onPointerUp);
    }

    function handleNorthDrag(evt) {
      const diffY = Math.max(drag.startY - getClientY(evt), MIN_HEIGHT - drag.baseHeight);
      contentEl.style.height = `${drag.baseHeight + diffY}px`;
      winEl.style.top = `${drag.baseTop - diffY}px`;
      drag.startY = getClientY(evt);
      drag.baseHeight = contentEl.offsetHeight;
      drag.baseTop = parseFloat(winEl.style.top) || winEl.getBoundingClientRect().top;
    }

    function handleEastDrag(evt) {
      const diffX = drag.startX - getClientX(evt);
      winEl.style.width = `${Math.max(MIN_WIDTH, drag.baseWidth - diffX)}px`;
      drag.startX = getClientX(evt);
      drag.baseWidth = winEl.offsetWidth;
    }

    function handleSouthDrag(evt) {
      const diffY = drag.startY - getClientY(evt);
      contentEl.style.height = `${Math.max(MIN_HEIGHT, drag.baseHeight - diffY)}px`;
      drag.startY = getClientY(evt);
      drag.baseHeight = contentEl.offsetHeight;
    }

    function handleWestDrag(evt) {
      const diffX = Math.max(drag.startX - getClientX(evt), MIN_WIDTH - drag.baseWidth);
      winEl.style.width = `${drag.baseWidth + diffX}px`;
      winEl.style.left = `${drag.baseLeft - diffX}px`;
      drag.startX = getClientX(evt);
      drag.baseWidth = winEl.offsetWidth;
      drag.baseLeft = parseFloat(winEl.style.left) || winEl.getBoundingClientRect().left;
    }

    function onPointerMove(evt) {
      switch (drag.type) {
        case DRAG_MOVE: {
          const dx = drag.startX - getClientX(evt);
          const dy = drag.startY - getClientY(evt);
          winEl.style.left = `${drag.baseLeft - dx}px`;
          winEl.style.top = `${drag.baseTop - dy}px`;
          drag.startX = getClientX(evt);
          drag.startY = getClientY(evt);
          drag.baseLeft = parseFloat(winEl.style.left) || winEl.getBoundingClientRect().left;
          drag.baseTop = parseFloat(winEl.style.top) || winEl.getBoundingClientRect().top;
          break;
        }
        case DRAG_N:
          handleNorthDrag(evt);
          break;
        case DRAG_NE:
          handleNorthDrag(evt);
          handleEastDrag(evt);
          break;
        case DRAG_E:
          handleEastDrag(evt);
          break;
        case DRAG_SE:
          handleSouthDrag(evt);
          handleEastDrag(evt);
          break;
        case DRAG_S:
          handleSouthDrag(evt);
          break;
        case DRAG_SW:
          handleSouthDrag(evt);
          handleWestDrag(evt);
          break;
        case DRAG_W:
          handleWestDrag(evt);
          break;
        case DRAG_NW:
          handleNorthDrag(evt);
          handleWestDrag(evt);
          break;
        default:
          break;
      }

      if (drag.type !== DRAG_NONE) {
        adjustWindowToViewport(winEl, contentEl, null);
      }
    }

    function onPointerUp() {
      if (drag.type === DRAG_NONE) return;
      drag.type = DRAG_NONE;
      document.removeEventListener("mousemove", onPointerMove);
      document.removeEventListener("mouseup", onPointerUp);
      adjustWindowToViewport(winEl, contentEl, null);
    }

    windowMeta.endInteraction = onPointerUp;

    header.addEventListener("mousedown", (evt) => {
      if (winEl.dataset.perm !== "true") return;
      if (evt.button !== 0) return;
      if (evt.target.closest(".jhp-hwin__btn")) return;
      evt.preventDefault();
      beginInteraction(evt, DRAG_MOVE);
    });

    addResizeHandle(winEl, "jhp-resize-n", DRAG_N, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-ne", DRAG_NE, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-e", DRAG_E, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-se", DRAG_SE, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-s", DRAG_S, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-sw", DRAG_SW, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-w", DRAG_W, beginInteraction);
    addResizeHandle(winEl, "jhp-resize-nw", DRAG_NW, beginInteraction);
  }

  function createWindow({ title, pageUrl, isPermanent, onClose }) {
    syncThemeVars();

    const id = ++nextWindowId;
    const zIndex = ++nextZIndex;

    const winEl = document.createElement("div");
    winEl.className = "jhp-hwin";
    winEl.dataset.perm = isPermanent ? "true" : "false";
    winEl.style.zIndex = String(zIndex);
    winEl.style.visibility = "hidden";

    const topBorder = document.createElement("div");
    topBorder.className = "jhp-border jhp-border--top";

    const header = document.createElement("div");
    header.className = "jhp-hwin__header";

    const titleEl = document.createElement("span");
    titleEl.className = "jhp-hwin__title";
    let pageTitle = title;

    function updateTitleDisplay() {
      const permanent = winEl.dataset.perm === "true";
      titleEl.textContent = permanent ? pageTitle : TRANSIENT_TITLE_HINT;
      titleEl.title = permanent ? pageTitle : TRANSIENT_TITLE_HINT;
    }

    updateTitleDisplay();

    const actions = document.createElement("div");
    actions.className = "jhp-hwin__actions";

    const followLink = document.createElement("a");
    followLink.className = "jhp-hwin__btn jhp-hwin__btn--link";
    followLink.href = pageUrl;
    followLink.textContent = "Follow link";
    followLink.title = "Follow link";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "jhp-hwin__btn";
    closeBtn.textContent = "Close";
    closeBtn.title = "Close (CTRL click to close all)";

    actions.appendChild(followLink);
    actions.appendChild(closeBtn);

    header.appendChild(titleEl);
    header.appendChild(actions);
    topBorder.appendChild(header);

    const contentEl = document.createElement("div");
    contentEl.className = "jhp-hwin__content main-content";

    const bottomBorder = document.createElement("div");
    bottomBorder.className = "jhp-border jhp-border--bottom";

    winEl.appendChild(topBorder);
    winEl.appendChild(contentEl);
    winEl.appendChild(bottomBorder);
    document.body.appendChild(winEl);

    const windowMeta = {
      id,
      el: winEl,
      contentEl,
      endInteraction: null,
      setContent(node) {
        contentEl.innerHTML = "";
        contentEl.appendChild(node);
        fitWindowToContent(winEl, contentEl);
      },
      setLoading() {
        contentEl.innerHTML = '<div class="jhp-hwin__loading">Loading…</div>';
      },
      setError(message) {
        contentEl.innerHTML = `<div class="jhp-hwin__error">${message}</div>`;
      },
      setPosition(position) {
        setWindowPosition(winEl, contentEl, position);
      },
      setPermanent(value) {
        winEl.dataset.perm = value ? "true" : "false";
        updateTitleDisplay();
      },
      setPageTitle(value) {
        pageTitle = value;
        updateTitleDisplay();
      },
      close() {
        if (windowMeta.endInteraction) windowMeta.endInteraction();
        if (winEl.parentNode) winEl.parentNode.removeChild(winEl);
        openWindows.delete(id);
        if (typeof onClose === "function") onClose();
      },
    };

    setupWindowInteraction(winEl, topBorder, contentEl, windowMeta);

    closeBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (evt.ctrlKey || evt.metaKey) {
        closeAllWindows();
        return;
      }
      windowMeta.close();
    });

    openWindows.set(id, windowMeta);

    const onResize = () => adjustWindowToViewport(winEl, contentEl, null);
    window.addEventListener("resize", onResize);
    const originalClose = windowMeta.close.bind(windowMeta);
    windowMeta.close = () => {
      window.removeEventListener("resize", onResize);
      originalClose();
    };

    return windowMeta;
  }

  function getMeta(anchor) {
    if (!linkMeta.has(anchor)) {
      linkMeta.set(anchor, {
        isHovered: false,
        isLoading: false,
        isPermanent: false,
        windowMeta: null,
        hoverTimer: null,
        linkKey: null,
      });
    }
    return linkMeta.get(anchor);
  }

  function promoteToPermanent(meta) {
    meta.isPermanent = true;
    if (meta.windowMeta) meta.windowMeta.setPermanent(true);
    if (meta.linkKey) persistentUrls.add(meta.linkKey);
  }

  async function handleMouseOver(evt, anchor) {
    if (!isInternalPageLink(anchor)) return;

    const linkKey = normalizeLinkKey(resolveUrl(anchor.href));
    if (persistentUrls.has(linkKey)) return;

    cleanTempWindows(anchor);

    const meta = getMeta(anchor);
    tempAnchors.add(anchor);
    if (meta.isHovered || meta.isLoading) return;
    if (meta.isPermanent) return;

    meta.linkKey = linkKey;
    meta.isHovered = true;
    meta.isPermanent = evt.shiftKey;
    anchor.style.cursor = "progress";

    clearTimeout(meta.hoverTimer);

    const showPreview = async () => {
      if (!meta.isHovered && !meta.isPermanent) return;

      meta.isLoading = true;

      if (meta.windowMeta && !meta.isPermanent) {
        meta.windowMeta.close();
        meta.windowMeta = null;
      }

      const win = createWindow({
        title: anchor.textContent.trim() || linkKey,
        pageUrl: resolveUrl(anchor.href).pathname + resolveUrl(anchor.href).search + resolveUrl(anchor.href).hash,
        isPermanent: meta.isPermanent,
        onClose: () => {
          meta.isHovered = false;
          meta.isLoading = false;
          if (meta.linkKey) persistentUrls.delete(meta.linkKey);
          meta.isPermanent = false;
          meta.windowMeta = null;
          tempAnchors.delete(anchor);
          anchor.style.cursor = "";
        },
      });

      meta.windowMeta = win;
      win.setLoading();
      win.setPosition(getPositionFromEvent(evt, anchor));
      win.el.style.visibility = "visible";

      try {
        const loaded = await loadLinkContent(anchor);
        if (!meta.isHovered && !meta.isPermanent) {
          win.close();
          return;
        }

        win.setContent(loaded.content);
        win.setPageTitle(loaded.title);
        win.el.querySelector(".jhp-hwin__btn--link").href = loaded.pageUrl;
        win.setPosition(getPositionFromEvent(evt, anchor));

        if (meta.isPermanent) {
          promoteToPermanent(meta);
        }
      } catch (err) {
        if (meta.isHovered || meta.isPermanent) {
          win.setError("Could not load preview.");
        } else {
          win.close();
        }
      } finally {
        meta.isLoading = false;
        anchor.style.cursor = "";
      }
    };

    if (HOVER_DELAY_MS > 0) {
      meta.hoverTimer = setTimeout(showPreview, HOVER_DELAY_MS);
    } else {
      showPreview();
    }
  }

  function handleMouseLeave(evt, anchor) {
    const meta = linkMeta.get(anchor);
    if (!meta) return;

    clearTimeout(meta.hoverTimer);
    anchor.style.cursor = "";

    if (meta.isPermanent) return;

    if (evt.shiftKey) {
      promoteToPermanent(meta);
      if (meta.windowMeta) meta.windowMeta.setPermanent(true);
      return;
    }

    meta.isHovered = false;

    if (meta.isLoading) return;

    if (meta.windowMeta) {
      meta.windowMeta.close();
      meta.windowMeta = null;
    }
  }

  function handleMouseMove(evt, anchor) {
    const meta = linkMeta.get(anchor);
    if (!meta || meta.isPermanent) return;

    if (evt.shiftKey && !meta.isPermanent) {
      promoteToPermanent(meta);
      if (meta.windowMeta) meta.windowMeta.setPermanent(true);
      return;
    }

    if (!meta.windowMeta || meta.isLoading) return;

    meta.windowMeta.setPosition(getPositionFromEvent(evt, anchor));
  }

  function handleClick(evt, anchor) {
    const meta = linkMeta.get(anchor);
    if (!meta || !meta.windowMeta || meta.isPermanent) return;

    clearTimeout(meta.hoverTimer);
    meta.isHovered = false;
    meta.windowMeta.close();
    meta.windowMeta = null;
    anchor.style.cursor = "";
  }

  function onPointerOver(evt) {
    const anchor = evt.target.closest("a[href]");
    if (!anchor) return;
    handleMouseOver(evt, anchor);
  }

  function onPointerOut(evt) {
    const anchor = evt.target.closest("a[href]");
    if (!anchor) return;
    if (anchor.contains(evt.relatedTarget)) return;
    handleMouseLeave(evt, anchor);
  }

  function onPointerMove(evt) {
    const anchor = evt.target.closest("a[href]");
    if (!anchor) return;
    handleMouseMove(evt, anchor);
  }

  function onClick(evt) {
    const anchor = evt.target.closest("a[href]");
    if (!anchor) return;
    handleClick(evt, anchor);
  }

  async function openPreviewLink({ href, title, clientX, clientY, isPermanent = true }) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = title || href;

    if (!isInternalPageLink(anchor)) {
      window.location.href = href;
      return null;
    }

    const url = resolveUrl(href);
    const linkKey = normalizeLinkKey(url);

    for (const win of openWindows.values()) {
      const follow = win.el.querySelector(".jhp-hwin__btn--link");
      if (!follow) continue;
      try {
        if (normalizeLinkKey(resolveUrl(follow.href)) === linkKey) {
          win.el.style.zIndex = String(++nextZIndex);
          return win;
        }
      } catch {
        /* ignore malformed href */
      }
    }

    const win = createWindow({
      title: title || href,
      pageUrl: url.pathname + url.search + url.hash,
      isPermanent,
      onClose: () => {
        persistentUrls.delete(linkKey);
      },
    });

    win.setPermanent(isPermanent);
    const position = getPositionFromPoint(clientX, clientY);
    win.setLoading();
    win.setPosition(position);
    win.el.style.visibility = "visible";

    try {
      const loaded = await loadLinkContent(anchor);
      win.setContent(loaded.content);
      win.setPageTitle(loaded.title);
      const followLink = win.el.querySelector(".jhp-hwin__btn--link");
      if (followLink) followLink.href = loaded.pageUrl;
      win.setPosition(position);
      if (isPermanent) persistentUrls.add(linkKey);
    } catch {
      win.setError("Could not load preview.");
    }

    return win;
  }

  function openPreviewContent({ title, pageUrl, content, clientX, clientY, isPermanent = true, maxWidth = null }) {
    const win = createWindow({
      title: title || "Preview",
      pageUrl: pageUrl || window.location.href,
      isPermanent,
      onClose: () => {},
    });

    win.setPermanent(isPermanent);
    if (maxWidth) win.el.style.maxWidth = maxWidth;

    const position = getPositionFromPoint(clientX, clientY);
    rewriteContentLinks(content, pageUrl || window.location.pathname + window.location.search + window.location.hash);
    win.setContent(content);
    if (title) win.setPageTitle(title);
    win.setPosition(position);
    win.el.style.visibility = "visible";
    return win;
  }

  window.JekyllHoverPopup = {
    isAvailable() {
      return true;
    },
    openLink: openPreviewLink,
    openContent: openPreviewContent,
  };

  document.addEventListener("mouseover", onPointerOver, true);
  document.addEventListener("mouseout", onPointerOut, true);
  document.addEventListener("mousemove", onPointerMove, true);
  document.addEventListener("click", onClick, true);

  syncThemeVars();
})();
