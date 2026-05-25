(function () {
  "use strict";

  const config = window.__JHP_CONFIG__ || {};
  const HOVER_DELAY_MS = Number(config.hoverDelayMs) || 300;
  const MAX_VIEWPORT_WIDTH = 0.92;
  const MAX_VIEWPORT_HEIGHT = 0.92;
  const MIN_WIDTH = 150;
  const MIN_HEIGHT = 80;
  const BAR_HEIGHT = 20;
  const GAP = 10;

  const pageCache = new Map();
  const linkMeta = new WeakMap();
  const persistentUrls = new Set();
  const tempAnchors = new Set();
  const openWindows = new Map();
  let nextWindowId = 0;
  let nextZIndex = 10000;

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

  function isInternalPageLink(anchor) {
    if (!anchor || anchor.closest(".jhp-hwin__actions")) return false;

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

  function findSectionRoot(el) {
    if (!el) return null;
    if (headingLevel(el) != null) return el;
    const heading = el.closest("h1,h2,h3,h4,h5,h6");
    return heading || el;
  }

  function cloneSectionFromRoot(root, doc) {
    const wrapper = doc.createElement("div");
    wrapper.className = "jhp-section";

    const level = headingLevel(root);
    wrapper.appendChild(root.cloneNode(true));

    let sibling = root.nextElementSibling;
    while (sibling) {
      const siblingLevel = headingLevel(sibling);
      if (level != null && siblingLevel != null && siblingLevel <= level) break;
      if (level == null && siblingLevel != null) break;
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

    return {
      content,
      title,
      pageUrl: url.pathname + url.search + url.hash,
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
    contentEl.style.maxHeight = `${Math.floor(window.innerHeight * MAX_VIEWPORT_HEIGHT) - BAR_HEIGHT}px`;

    const contentWidth = contentEl.scrollWidth;
    const targetWidth = Math.min(
      Math.max(contentWidth + 24, MIN_WIDTH),
      Math.floor(window.innerWidth * MAX_VIEWPORT_WIDTH)
    );
    winEl.style.width = `${targetWidth}px`;

    const naturalHeight = contentEl.scrollHeight;
    const maxContentHeight = Math.floor(window.innerHeight * MAX_VIEWPORT_HEIGHT) - BAR_HEIGHT;
    contentEl.style.maxHeight = `${Math.min(naturalHeight, maxContentHeight)}px`;
  }

  function createWindow({ title, pageUrl, isPermanent, onClose }) {
    const id = ++nextWindowId;
    const zIndex = ++nextZIndex;

    const winEl = document.createElement("div");
    winEl.className = "jhp-hwin";
    winEl.dataset.perm = isPermanent ? "true" : "false";
    winEl.style.zIndex = String(zIndex);
    winEl.style.visibility = "hidden";

    const header = document.createElement("div");
    header.className = "jhp-hwin__header";

    const titleEl = document.createElement("span");
    titleEl.className = "jhp-hwin__title";
    titleEl.textContent = title;
    titleEl.title = title;

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

    const contentEl = document.createElement("div");
    contentEl.className = "jhp-hwin__content";

    winEl.appendChild(header);
    winEl.appendChild(contentEl);
    document.body.appendChild(winEl);

    const drag = { active: false, startX: 0, startY: 0, baseLeft: 0, baseTop: 0 };

    function onMouseMoveDrag(evt) {
      if (!drag.active) return;
      const dx = drag.startX - getClientX(evt);
      const dy = drag.startY - getClientY(evt);
      winEl.style.left = `${drag.baseLeft - dx}px`;
      winEl.style.top = `${drag.baseTop - dy}px`;
      adjustWindowToViewport(winEl, contentEl, null);
    }

    function onMouseUpDrag() {
      drag.active = false;
      document.removeEventListener("mousemove", onMouseMoveDrag);
      document.removeEventListener("mouseup", onMouseUpDrag);
    }

    header.addEventListener("mousedown", (evt) => {
      if (winEl.dataset.perm !== "true") return;
      if (evt.target.closest(".jhp-hwin__btn")) return;
      drag.active = true;
      drag.startX = getClientX(evt);
      drag.startY = getClientY(evt);
      drag.baseLeft = parseFloat(winEl.style.left) || winEl.getBoundingClientRect().left;
      drag.baseTop = parseFloat(winEl.style.top) || winEl.getBoundingClientRect().top;
      winEl.style.zIndex = String(++nextZIndex);
      document.addEventListener("mousemove", onMouseMoveDrag);
      document.addEventListener("mouseup", onMouseUpDrag);
    });

    closeBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (evt.ctrlKey || evt.metaKey) {
        closeAllWindows();
        return;
      }
      windowMeta.close();
    });

    const windowMeta = {
      id,
      el: winEl,
      contentEl,
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
      },
      close() {
        onMouseUpDrag();
        if (winEl.parentNode) winEl.parentNode.removeChild(winEl);
        openWindows.delete(id);
        if (typeof onClose === "function") onClose();
      },
    };

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
    meta.hoverTimer = setTimeout(async () => {
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
        win.el.querySelector(".jhp-hwin__title").textContent = loaded.title;
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
    }, HOVER_DELAY_MS);
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

  document.addEventListener("mouseover", onPointerOver, true);
  document.addEventListener("mouseout", onPointerOut, true);
  document.addEventListener("mousemove", onPointerMove, true);
  document.addEventListener("click", onClick, true);
})();
