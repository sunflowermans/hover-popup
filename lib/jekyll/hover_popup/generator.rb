module Jekyll
  module HoverPopup
    class Generator < Jekyll::Generator
      safe true
      priority :low

      def generate(site)
        cfg = (site.config["hover_popup"] || {})
        return if cfg["enabled"] == false

        assets_path = cfg["assets_path"] || "/assets/jekyll-hover-popup"
        assets_path = "/#{assets_path}" unless assets_path.start_with?("/")

        asset_dir = File.expand_path("../../../assets/jekyll-hover-popup", __dir__)

        files = {
          "hover_popup.js" => File.join(asset_dir, "hover_popup.js"),
          "hover_popup.css" => File.join(asset_dir, "hover_popup.css"),
        }

        files.each do |name, source_path|
          next unless File.file?(source_path)
          site.static_files << AssetFile.new(
            site,
            site.source,
            assets_path.sub(%r{\A/}, ""),
            name,
            source_path: source_path
          )
        end
      end
    end
  end
end
