module Jekyll
  module HoverPopup
    module Hooks
      def self.register!
        Jekyll::Hooks.register(%i[pages documents], :post_render) do |doc|
          site = doc.site
          cfg = (site.config["hover_popup"] || {})
          next if cfg["enabled"] == false
          next unless doc.respond_to?(:output_ext) && doc.output_ext == ".html"

          assets_path = cfg["assets_path"] || "/assets/jekyll-hover-popup"
          assets_path = "/#{assets_path}" unless assets_path.start_with?("/")
          hover_delay_ms = cfg["hover_delay_ms"] || 300

          begin
            doc.output = inject_assets(doc.output.to_s, assets_path: assets_path, hover_delay_ms: hover_delay_ms)
          rescue StandardError => e
            Jekyll.logger.warn("jekyll-hover-popup:", "Failed to process #{doc.relative_path}: #{e.class}: #{e.message}")
          end
        end
      end

      def self.inject_assets(html, assets_path:, hover_delay_ms:)
        return html if html.include?('data-hover-popup-root="true"')

        tags = <<~HTML
          <script>
            window.__JHP_CONFIG__ = #{{
              hoverDelayMs: hover_delay_ms
            }.to_json};
          </script>
          <link rel="stylesheet" href="#{assets_path}/hover_popup.css" />
          <script defer src="#{assets_path}/hover_popup.js" data-hover-popup-root="true"></script>
        HTML

        if html.include?("</body>")
          html.sub("</body>", "#{tags}\n</body>")
        else
          "#{html}\n#{tags}\n"
        end
      end
    end
  end
end

Jekyll::HoverPopup::Hooks.register!
