module Jekyll
  module HoverPopup
    class AssetFile < Jekyll::StaticFile
      def initialize(site, base, dir, name, source_path:)
        super(site, base, dir, name)
        @source_path = source_path
      end

      def write(dest)
        dest_path = destination(dest)
        FileUtils.mkdir_p(File.dirname(dest_path))
        FileUtils.cp(@source_path, dest_path)
        true
      end
    end
  end
end
