# jekyll-hover-popup

A Jekyll plugin for [Just the Docs](https://github.com/just-the-docs/just-the-docs) sites that shows in-page hover previews for internal documentation links.

Inspired by the hover window behavior in [5etools](https://github.com/5etools/5etools-src).

## Features

- Hover over an internal link to see a reference preview
- Persist windows by holding the SHIFT key
- Close all windows by holding CTRL while closing one
- Minimize windows by double clicking the title bar
- Navigate to an entry later by clicking the link in the title bar
- Eight point window resize
- Exposes `window.JekyllHoverPopup` for other plugins

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
  nav_hover_preview: true
```

Add a `hover_delay_ms` to delay the preview window creation

Set `nav_hover_preview: false` to disable hover previews for links inside navigation elements (`.site-nav`, `nav`, `[role="navigation"]`, etc.).

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

[MIT](LICENSE)
