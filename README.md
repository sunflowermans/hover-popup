# jekyll-hover-popup

A Jekyll plugin for [Just the Docs](https://github.com/just-the-docs/just-the-docs) sites that shows in-page hover previews for internal documentation links.

Inspired by the hover window behavior in [5etools](https://github.com/5etools/5etools-src).

## Features

- Hover an internal link to preview its target content in a floating window
- Hold **Shift** while hovering (or when leaving the link) to pin the preview
- Pinned windows show **Follow link** and **Close** (Ctrl/Cmd+click Close to close all)
- Pinned links do not open additional previews on further hovers
- Section links (`#heading-id`) show only that section; page links show the full page content
- External links and non-page links are ignored
- Popup windows are resizable (8 drag handles) and styled from the host page's computed theme
- Exposes `window.JekyllHoverPopup` for other plugins (for example, image map region clicks)

## Install

Add to your site `Gemfile`:

```ruby
group :jekyll_plugins do
  gem "jekyll-hover-popup", path: "/path/to/hover-popup"
end
```

Then in `_config.yml`:

```yml
plugins:
  - jekyll-hover-popup
```

## Configuration

Optional `_config.yml` settings:

```yml
hover_popup:
  enabled: true
  assets_path: /assets/jekyll-hover-popup
  hover_delay_ms: 0
```

## JavaScript API

When loaded, the plugin exposes:

```js
window.JekyllHoverPopup.openLink({
  href: "#section-id",
  title: "Section title",
  clientX: 120,
  clientY: 240,
  isPermanent: true,
});

window.JekyllHoverPopup.openContent({
  title: "Custom preview",
  pageUrl: "/docs/page/",
  content: document.createElement("div"),
  clientX: 120,
  clientY: 240,
  isPermanent: true,
  maxWidth: "min(96vw, 1200px)",
});
```

## License

MIT
